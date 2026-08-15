import { GameManager } from '../src/Matchmaking/GameManager';

const mockSave = jest.fn().mockImplementation(() => Promise.resolve());

let nextClaimAvailable = true;

function makeGameDoc(state = 'pending') {
  return {
    gameId: 1,
    map: 'MapA',
    queueId: 'queue-1',
    isRanked: true,
    state,
    team1: ['a', 'b'],
    team2: ['c', 'd'],
    winners: state === 'scored' ? ['a', 'b'] : [],
    losers: state === 'scored' ? ['c', 'd'] : [],
    mvps: state === 'scored' ? ['a'] : [],
    bedbreaks: state === 'scored' ? ['c'] : [],
    reason: '',
    startTime: new Date(Date.now() - 600000),
    endTime: undefined,
    channels: { text: 'text-1', team1Voice: 'v1', team2Voice: 'v2' },
    save: mockSave
  };
}

function makeUser(id: string, elo = 1000) {
  return {
    discordId: id,
    ign: id.toUpperCase(),
    elo,
    wins: 0, losses: 0, games: 0, mvps: 0,
    kills: 0, deaths: 0, finalKills: 0, bedBroken: 0,
    diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0,
    winstreak: 0, losestreak: 0, experience: 0, level: 1,
    kdr: 0, wlr: 0,
    recentGames: [],
    dailyElo: [],
    save: mockSave
  };
}

const makeRank = (overrides: any = {}) => ({
  roleId: 'rank-1', startElo: 0, endElo: 99999,
  winElo: 30, loseElo: 20, mvpElo: 10, bedElo: 5,
  ...overrides
});

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({})
  }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({})
  }
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: jest.fn() }
}));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: {} }));
jest.mock('../src/models/Counter', () => ({
  getNextSequence: jest.fn().mockResolvedValue(100),
  Counter: {}
}));
jest.mock('../src/utils/scoreImage', () => ({
  generateScoreImageBuffer: jest.fn().mockResolvedValue(null)
}));
jest.mock('../src/utils/fix', () => ({
  fix: jest.fn().mockResolvedValue(undefined),
  safeFix: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../src/utils/userStats', () => ({
  updateDailyElo: jest.fn(),
  ensureUserStats: jest.fn(),
  resetUserStats: jest.fn(),
  computeWlr: (w: number, l: number) => (l > 0 ? w / l : w)
}));
jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: {
    getInstance: () => ({
      createChannel: jest.fn().mockResolvedValue({ id: 'ch' }),
      deleteChannel: jest.fn().mockResolvedValue(undefined),
      moveMembers: jest.fn().mockResolvedValue([]),
      setMemberNickname: jest.fn().mockResolvedValue(undefined),
      updateMemberRoles: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn().mockResolvedValue(undefined)
    })
  }
}));

const GameModel = require('../src/models/Game').default;
const UserModel = require('../src/models/User').default;
const EloRankModel = require('../src/models/EloRank').default;

const wsManagerMock = {
  send: jest.fn(),
  setGlobalHandler: jest.fn()
};

const clientMock = {
  guilds: { cache: { first: jest.fn().mockReturnValue(undefined) } },
  channels: { cache: { get: jest.fn().mockReturnValue(undefined) } }
};

function setupGame(players: any[], gameDoc: any) {
  nextClaimAvailable = true;
  GameModel.findOne.mockImplementation(async () => gameDoc);
  GameModel.findOneAndUpdate.mockImplementation(async () => {
    if (!nextClaimAvailable) return null;
    nextClaimAvailable = false;
    return gameDoc;
  });
  UserModel.find.mockImplementation(async () => players);
  UserModel.findOne.mockImplementation(async ({ discordId }: any) =>
    players.find(p => p.discordId === discordId) || null
  );
  EloRankModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([makeRank()]) });
  mockSave.mockClear();
}

function makeManager(): GameManager {
  return new GameManager(clientMock as any, wsManagerMock as any);
}

async function settleWithDelay(promises: Promise<any>[]): Promise<any[]> {
  const results = await Promise.allSettled(promises);
  return results.map(r => (r.status === 'fulfilled' ? { ok: true, value: r.value } : { ok: false, reason: (r as any).reason?.message }));
}

describe('GameManager race conditions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('concurrent scoreGame calls settle the game exactly once', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a', 1000), makeUser('b', 1100), makeUser('c', 1200), makeUser('d', 1300)];
    setupGame(players, gameDoc);
    const manager = makeManager();

    const results = await settleWithDelay([
      manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: ['A'], bedbreaks: ['C'] }),
      manager.scoreGame({ gameId: 1, winningTeam: 2, mvps: ['D'], bedbreaks: [] })
    ]);

    const succeeded = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatch(/already settled/);

    // Stats must have been applied exactly once: winner +winElo+mvpElo, loser -loseElo+bedElo.
    const winner = players.find(p => p.discordId === 'a')!;
    const loser = players.find(p => p.discordId === 'c')!;
    expect(winner.elo).toBe(1000 + 30 + 10);
    expect(loser.elo).toBe(1200 - 20 + 5);
  });

  it('concurrent voidGame calls revert exactly once', async () => {
    const recentGame = {
      gameId: 1, map: 'MapA', eloGain: -20, oldElo: 1200, newElo: 1180,
      kills: 0, deaths: 0, bedBroken: 0, finalKills: 0,
      won: false, ismvp: false, date: new Date(), state: 'scored',
      startTime: new Date(), diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0
    };
    const players = [
      { ...makeUser('a', 1000), recentGames: [] },
      { ...makeUser('b', 1100), recentGames: [] },
      { ...makeUser('c', 1200), recentGames: [{ ...recentGame }] },
      { ...makeUser('d', 1300), recentGames: [] }
    ];
    const gameDoc = makeGameDoc('scored');
    gameDoc.winners = ['c'];
    gameDoc.losers = ['a', 'b', 'd'];
    setupGame(players, gameDoc);
    const manager = makeManager();

    const results = await settleWithDelay([
      manager.voidGame(1, 'test void'),
      manager.voidGame(1, 'test void 2')
    ]);

    const succeeded = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatch(/already settled/);

    const reverted = players.find(p => p.discordId === 'c');
    expect(reverted!.elo).toBe(1200);
  });

  it('scoreGame and voidGame racing: exactly one wins', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const manager = makeManager();

    for (let i = 0; i < 5; i++) {
      setupGame(players, makeGameDoc());
      const results = await settleWithDelay([
        manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: ['A'] }),
        manager.voidGame(1, 'voided instead')
      ]);
      const succeeded = results.filter(r => r.ok);
      expect(succeeded).toHaveLength(1);
    }
  });

  it('scoring a game that is already settled in the DB is rejected', async () => {
    const gameDoc = makeGameDoc('scored');
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    // No claim available: DB already has it scored.
    nextClaimAvailable = false;
    const manager = makeManager();

    await expect(manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: ['A'] }))
      .rejects.toThrow(/already settled/);
  });

  it('voiding a never-scored game still decrements games exactly once', async () => {
    const recentGame = {
      gameId: 1, map: 'MapA', eloGain: 0, oldElo: 1000, newElo: 1000,
      kills: 0, deaths: 0, bedBroken: 0, finalKills: 0,
      won: false, ismvp: false, date: new Date(), state: 'pending',
      startTime: new Date(), diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0
    };
    const players = [
      { ...makeUser('a', 1000), games: 5, recentGames: [{ ...recentGame }] },
      { ...makeUser('b', 1100), games: 5, recentGames: [{ ...recentGame }] },
      { ...makeUser('c', 1200), games: 5, recentGames: [{ ...recentGame }] },
      { ...makeUser('d', 1300), games: 5, recentGames: [{ ...recentGame }] }
    ];
    const gameDoc = makeGameDoc('pending');
    setupGame(players, gameDoc);
    const manager = makeManager();

    const result = await manager.voidGame(1, 'player disconnected');
    expect(result.gameId).toBe(1);

    for (const p of players) {
      expect(p.games).toBe(4);
    }
  });
});
