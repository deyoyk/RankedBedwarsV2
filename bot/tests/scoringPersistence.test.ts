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
    winners: [],
    losers: [],
    mvps: [],
    bedbreaks: [],
    reason: '',
    startTime: new Date(Date.now() - 600000),
    endTime: undefined,
    channels: { text: 'text-1', team1Voice: 'v1', team2Voice: 'v2' },
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function makeUser(id: string, elo = 1000, saveImpl?: () => Promise<unknown>) {
  return {
    discordId: id,
    ign: id.toUpperCase(),
    elo,
    wins: 0, losses: 0, games: 0, mvps: 0,
    kills: 0, deaths: 0, finalKills: 0, bedBroken: 0,
    diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0,
    winStreak: 0, loseStreak: 0, experience: 0, level: 1,
    kdr: 0, wlr: 0,
    recentGames: [],
    dailyElo: [],
    save: jest.fn(saveImpl ?? (() => Promise.resolve())),
  };
}

const makeRank = () => ({
  roleId: 'rank-1', startElo: 0, endElo: 99999,
  winElo: 30, loseElo: 20, mvpElo: 10, bedElo: 5,
});

const mockGetNextSequence = jest.fn();
const mockCounterUpdateOne = jest.fn().mockResolvedValue({});

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
  getNextSequence: (...args: unknown[]) => mockGetNextSequence(...args),
  Counter: { updateOne: (...args: unknown[]) => mockCounterUpdateOne(...args) },
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

describe('scoring persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCounterUpdateOne.mockResolvedValue({});
  });

  it('scoreGame surfaces partial stat-save failures instead of succeeding silently', async () => {
    const gameDoc = makeGameDoc();
    const players = [
      makeUser('a', 1000),
      makeUser('b', 1100, () => Promise.reject(new Error('db down'))),
      makeUser('c', 1200),
      makeUser('d', 1300),
    ];
    setupGame(players, gameDoc);
    await expect(makeManager().scoreGame({ gameId: 1, winningTeam: 1, mvps: ['A'], bedbreaks: [] }))
      .rejects.toThrow(/Failed to persist 1\/4 player updates/);
  });

  it('scoreGame resolves when every player save succeeds', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const result = await makeManager().scoreGame({ gameId: 1, winningTeam: 2, mvps: [], bedbreaks: [] });
    expect(result.winningTeam).toBe(2);
  });

  it('getNextGameId fallback reserves the counter atomically', async () => {
    mockGetNextSequence.mockRejectedValueOnce(new Error('counter unavailable'));
    GameModel.findOne.mockReturnValueOnce({ sort: () => ({ select: async () => ({ gameId: 41 }) }) });
    const result = await makeManager().getNextGameId();
    expect(result).toBe(42);
    expect(mockCounterUpdateOne).toHaveBeenCalledWith({ _id: 'gameId' }, { $max: { seq: 42 } }, { upsert: true });
  });
});
