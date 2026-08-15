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
    timeline: [],
    save: mockSave
  };
}

function makeUser(id: string, elo = 1000) {
  return {
    discordId: id,
    ign: id.toUpperCase(),
    elo,
    wins: 0, losses: 0, games: 0, mvps: 0,
    kills: 0, deaths: 0, finalKills: 0, finalDeaths: 0, bedBroken: 0,
    diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0,
    winstreak: 0, losestreak: 0, experience: 0, level: 1,
    kdr: 0, wlr: 0,
    playtimeSeconds: 0, peakElo: 0,
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

function setupGame(players: any[], gameDoc: any, rank: any = makeRank()) {
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
  EloRankModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([rank]) });
  mockSave.mockClear();
}

function makeManager(): GameManager {
  return new GameManager(clientMock as any, wsManagerMock as any);
}

describe('GameManager timeline + new user stats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores the scoring timeline on the game document', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const manager = makeManager();

    const timeline = [
      { type: 'final_kill', player: 'A', target: 'C', timestamp: 1000 },
      { type: 'bed_broken', player: 'C', timestamp: 2000 },
      { type: 'kill', player: 'B', amount: 1, timestamp: 3000 }
    ];

    await manager.scoreGame({
      gameId: 1, winningTeam: 1, mvps: ['A'], bedbreaks: ['C'], timeline
    });

    expect(gameDoc.timeline).toEqual(timeline);
    expect(mockSave).toHaveBeenCalled();
  });

  it('accumulates finalDeaths from playerData (camelCase and lowercase)', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const manager = makeManager();

    const playerData = {
      A: { kills: 5, finalDeaths: 2 },
      C: { kills: 1, finaldeaths: 3 }
    } as any;

    await manager.scoreGame({
      gameId: 1, winningTeam: 1, mvps: ['A'], bedbreaks: ['C'], playerData
    });

    const winner = players.find(p => p.discordId === 'a')!;
    const loser = players.find(p => p.discordId === 'c')!;
    expect(winner.finalDeaths).toBe(2);
    expect(loser.finalDeaths).toBe(3);
    expect(winner.finalDeaths).toBe((winner.recentGames as any[])[0].finalDeaths);
  });

  it('accumulates playtimeSeconds from game start/end times', async () => {
    const gameDoc = makeGameDoc();
    gameDoc.startTime = new Date(Date.now() - 600000);
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const manager = makeManager();

    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: ['A'], bedbreaks: [] });

    const player = players.find(p => p.discordId === 'a')!;
    expect(player.playtimeSeconds).toBeGreaterThanOrEqual(595);
    expect(player.playtimeSeconds).toBeLessThanOrEqual(605);
  });

  it('tracks peakElo as the max elo ever achieved and never decreases it', async () => {
    const manager = makeManager();

    // Game 1: elo 1000, win +30 -> newElo 1030, peakElo becomes 1030.
    const game1 = makeGameDoc();
    const players1 = [makeUser('a', 1000), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players1, game1);
    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [] });
    const playerA = players1.find(p => p.discordId === 'a')!;
    expect(playerA.elo).toBe(1030);
    expect(playerA.peakElo).toBe(1030);

    // Game 2: same player, fresh doc carrying elo 1030 / peakElo 1030,
    // win +30 -> newElo 1060, peakElo takes the new max.
    const game2 = makeGameDoc();
    const players2 = [
      { ...makeUser('a', 1030), peakElo: 1030 },
      makeUser('b'), makeUser('c'), makeUser('d')
    ];
    setupGame(players2, game2);
    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [] });
    const playerA2 = players2.find(p => p.discordId === 'a')!;
    expect(playerA2.elo).toBe(1060);
    expect(playerA2.peakElo).toBe(1060);

    // Game 3: peak already 1060, player loses (-20) -> peakElo stays 1060.
    const game3 = makeGameDoc();
    const players3 = [
      { ...makeUser('a', 1030), peakElo: 1060 },
      makeUser('b'), makeUser('c'), makeUser('d')
    ];
    setupGame(players3, game3);
    await manager.scoreGame({ gameId: 1, winningTeam: 2, mvps: [], bedbreaks: [] });
    const playerA3 = players3.find(p => p.discordId === 'a')!;
    expect(playerA3.elo).toBe(1010);
    expect(playerA3.peakElo).toBe(1060);
  });

  it('void reverts finalDeaths but keeps playtimeSeconds and peakElo', async () => {
    const recentGame = {
      gameId: 1, map: 'MapA', eloGain: 30, oldElo: 1200, newElo: 1230,
      kills: 5, deaths: 2, bedBroken: 0, finalKills: 1, finalDeaths: 2,
      won: true, ismvp: false, date: new Date(), state: 'scored',
      startTime: new Date(Date.now() - 600000), endTime: new Date(),
      diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0
    };
    const players = [
      { ...makeUser('a', 1000), recentGames: [] },
      { ...makeUser('b', 1100), recentGames: [] },
      { ...makeUser('c', 1200), recentGames: [{ ...recentGame }] },
      { ...makeUser('d', 1300), recentGames: [] }
    ];
    const scoredPlayer = players.find(p => p.discordId === 'c')!;
    scoredPlayer.finalDeaths = 2;
    scoredPlayer.playtimeSeconds = 600;
    scoredPlayer.peakElo = 1230;

    const gameDoc = makeGameDoc('scored');
    gameDoc.winners = ['c'];
    gameDoc.losers = ['a', 'b', 'd'];
    setupGame(players, gameDoc);
    const manager = makeManager();

    await manager.voidGame(1, 'test void');

    expect(scoredPlayer.finalDeaths).toBe(0);
    expect(scoredPlayer.playtimeSeconds).toBe(600);
    expect(scoredPlayer.peakElo).toBe(1230);
  });
});
