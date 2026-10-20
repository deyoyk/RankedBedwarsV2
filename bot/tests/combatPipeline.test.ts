import { GameManager } from '../src/Matchmaking/GameManager';

function makeGameDoc(state = 'pending') {
  return {
    gameId: 1,
    map: 'MapA',
    queueId: 'queue-1',
    isRanked: true,
    state,
    team1: ['a', 'b'],
    team2: ['c', 'd'],
    winners: [] as string[],
    losers: [] as string[],
    mvps: [],
    bedbreaks: [],
    reason: '',
    startTime: new Date(Date.now() - 600000),
    endTime: undefined,
    channels: { text: 'text-1', team1Voice: 'v1', team2Voice: 'v2' },
    combat: [] as any[],
    save: jest.fn().mockResolvedValue(undefined),
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
    damageDealt: 0, damageTaken: 0, assists: 0, bestStreak: 0, firstBloods: 0,
    recentGames: [] as any[],
    dailyElo: [],
    save: jest.fn().mockResolvedValue(undefined),
  };
}

const makeRank = () => ({
  roleId: 'rank-1', startElo: 0, endElo: 99999,
  winElo: 30, loseElo: 20, mvpElo: 10, bedElo: 5,
});

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: {} }));
jest.mock('../src/models/Counter', () => ({
  getNextSequence: jest.fn().mockResolvedValue(100),
  Counter: { updateOne: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/utils/scoreImage', () => ({
  generateScoreImageBuffer: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/utils/fix', () => ({
  fix: jest.fn().mockResolvedValue(undefined),
  safeFix: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/utils/userStats', () => ({
  updateDailyElo: jest.fn(),
  ensureUserStats: jest.fn(),
  resetUserStats: jest.fn(),
  computeWlr: (w: number, l: number) => (l > 0 ? w / l : w),
}));
jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: {
    getInstance: () => ({
      createChannel: jest.fn().mockResolvedValue({ id: 'ch' }),
      deleteChannel: jest.fn().mockResolvedValue(undefined),
      moveMembers: jest.fn().mockResolvedValue([]),
      setMemberNickname: jest.fn().mockResolvedValue(undefined),
      updateMemberRoles: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

const GameModel = require('../src/models/Game').default;
const UserModel = require('../src/models/User').default;
const EloRankModel = require('../src/models/EloRank').default;

const wsManagerMock = { send: jest.fn(), setGlobalHandler: jest.fn() };
const clientMock = {
  guilds: { cache: { first: jest.fn().mockReturnValue(undefined) } },
  channels: { cache: { get: jest.fn().mockReturnValue(undefined) } },
};

function setupGame(players: any[], gameDoc: any) {
  GameModel.findOne.mockImplementation(async () => gameDoc);
  GameModel.findOneAndUpdate.mockImplementation(async () => gameDoc);
  UserModel.find.mockImplementation(async () => players);
  UserModel.findOne.mockImplementation(async ({ discordId }: any) =>
    players.find((p: any) => p.discordId === discordId) || null);
  EloRankModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([makeRank()]) });
}

function makeManager(): GameManager {
  return new GameManager(clientMock as any, wsManagerMock as any);
}

function combatPlayerData() {
  return {
    a: { kills: 3, deaths: 1, damageDealt: 320.5, damageTaken: 120, assists: 1, maxStreak: 3, firstBlood: true, fights: { C: { kills: 2, damageDealt: 200 }, D: { kills: 1, damageDealt: 120.5 } } },
    b: { kills: 0, deaths: 2, damageDealt: 40, damageTaken: 300, assists: 0, maxStreak: 0, fights: { C: { kills: 0, damageDealt: 40 } } },
    c: { kills: 2, deaths: 2, damageDealt: 280, damageTaken: 290, assists: 1, maxStreak: 2, fights: { A: { kills: 1, damageDealt: 120 }, B: { kills: 1, damageDealt: 160 } } },
    d: { kills: 1, deaths: 1, damageDealt: 140.5, damageTaken: 130.5, assists: 0, maxStreak: 1, fights: { A: { kills: 0, damageDealt: 0 }, B: { kills: 0, damageDealt: 0 } } },
  };
}

describe('combat history pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists per-player combat totals, recent entries and mirrored per-opponent fights', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const manager = makeManager();

    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [], playerData: combatPlayerData() } as any);

    const a = players.find((p) => p.discordId === 'a')!;
    expect(a.damageDealt).toBeCloseTo(320.5);
    expect(a.damageTaken).toBe(120);
    expect(a.assists).toBe(1);
    expect(a.bestStreak).toBe(3);
    expect(a.firstBloods).toBe(1);
    const entry = a.recentGames[0];
    expect(entry.damageDealt).toBeCloseTo(320.5);
    expect(entry.assists).toBe(1);
    expect(entry.maxStreak).toBe(3);
    expect(entry.firstBlood).toBe(true);
    expect(entry.fights).toBe(2);

    expect(gameDoc.combat).toHaveLength(4);
    const aCombat = gameDoc.combat.find((c: any) => c.player === 'a')!;
    expect(aCombat.damageDealt).toBeCloseTo(320.5);
    expect(aCombat.fights).toHaveLength(2);
    const vsC = aCombat.fights.find((f: any) => f.opponent === 'C');
    expect(vsC.kills).toBe(2);
    expect(vsC.deaths).toBe(1);
    expect(vsC.damageDealt).toBe(200);
    expect(vsC.damageTaken).toBe(120);
  });

  it('voiding a scored game reverts combat totals but keeps the best streak', async () => {
    const recent = {
      gameId: 1, map: 'MapA', eloGain: 30, oldElo: 1000, newElo: 1030,
      kills: 3, deaths: 1, bedBroken: 0, finalKills: 1, won: true, ismvp: false,
      date: new Date(), state: 'scored', startTime: new Date(),
      damageDealt: 320.5, damageTaken: 120, assists: 1, firstBlood: true,
    };
    const players = [
      { ...makeUser('a', 1030), damageDealt: 320.5, damageTaken: 120, assists: 1, bestStreak: 3, firstBloods: 1, recentGames: [{ ...recent }] },
      { ...makeUser('b', 1000), recentGames: [] },
      { ...makeUser('c', 1000), recentGames: [] },
      { ...makeUser('d', 1000), recentGames: [] },
    ];
    const gameDoc = makeGameDoc('scored');
    gameDoc.winners = ['a', 'b'];
    gameDoc.losers = ['c', 'd'];
    setupGame(players, gameDoc);
    const manager = makeManager();

    await manager.voidGame(1, 'test void');

    const a = players.find((p) => p.discordId === 'a')!;
    expect(a.damageDealt).toBe(0);
    expect(a.damageTaken).toBe(0);
    expect(a.assists).toBe(0);
    expect(a.firstBloods).toBe(0);
    expect(a.bestStreak).toBe(3);
  });
});
