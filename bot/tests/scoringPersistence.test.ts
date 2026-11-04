import { GameManager } from '../src/Matchmaking/GameManager';
import config from '../src/config/config';

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

  it('does not award ELO or streak bonuses for private games', async () => {
    const gameDoc = makeGameDoc();
    (gameDoc as any).isPrivate = true;
    const players = [makeUser('a', 1000), makeUser('b', 1100), makeUser('c', 1200), makeUser('d', 1300)];
    setupGame(players, gameDoc);

    await makeManager().scoreGame({ gameId: 1, winningTeam: 1, mvps: ['A'], bedbreaks: [] });

    expect(players[0].elo).toBe(1000);
    expect(players[2].elo).toBe(1200);
  });

  it('recovery scoring skips players whose stats were already applied', async () => {
    const gameDoc = makeGameDoc();
    const alreadyScored = makeUser('a', 1050);
    (alreadyScored as any).recentGames = [{ gameId: 1, state: 'scored' }];
    const players = [
      alreadyScored,
      makeUser('b', 1100),
      makeUser('c', 1200),
      makeUser('d', 1300),
    ];
    setupGame(players, gameDoc);

    await makeManager().scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [] }, true);

    expect(players[0].elo).toBe(1050);
    expect(players[0].wins).toBe(0);
    expect(players[1].elo).not.toBe(1100);
  });

  it('accepts active games for scoring after a warp success', async () => {
    const gameDoc = makeGameDoc('active');
    const gameDocWithSave = {
      ...gameDoc,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    GameModel.findOne.mockResolvedValue(gameDocWithSave);

    await makeManager().scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [] });

    expect(GameModel.findOneAndUpdate).toHaveBeenCalledWith(
      { gameId: 1, state: { $in: ['pending', 'active'] } },
      { $set: { endTime: expect.any(Date), state: 'scoring' } },
      { new: true },
    );
  });

  it('marks the game active when the plugin confirms a warp', async () => {
    const gameDoc = makeGameDoc('pending');
    GameModel.findOne.mockResolvedValue(gameDoc);
    const manager = makeManager();

    await (manager as any).handleWarpSuccess({ gameId: '1' });

    expect(gameDoc.state).toBe('active');
    expect(gameDoc.save).toHaveBeenCalled();
  });

  it('awards multiple MVPs and caps them to MAX_MVPS_PER_GAME', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const originalLimit = config.maxMvpsPerGame;
    config.maxMvpsPerGame = 2;

    try {
      await makeManager().scoreGame({
        gameId: 1,
        winningTeam: 1,
        mvps: ['A', 'B', 'C'],
        bedbreaks: [],
      });

      expect(players[0].mvps).toBe(1);
      expect(players[1].mvps).toBe(1);
      expect(players[2].mvps).toBe(0);
    } finally {
      config.maxMvpsPerGame = originalLimit;
    }
  });

  it('awards multiple bed breakers and caps them to MAX_BED_BREAKERS_PER_GAME', async () => {
    const gameDoc = makeGameDoc();
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players, gameDoc);
    const originalLimit = config.maxBedBreakersPerGame;
    config.maxBedBreakersPerGame = 2;

    try {
      await makeManager().scoreGame({
        gameId: 1,
        winningTeam: 1,
        mvps: [],
        bedbreaks: ['A', 'B', 'C'],
      });

      expect(players[0].bedBroken).toBe(1);
      expect(players[1].bedBroken).toBe(1);
      expect(players[2].bedBroken).toBe(0);
    } finally {
      config.maxBedBreakersPerGame = originalLimit;
    }
  });

  it('getNextGameId fallback reserves the counter atomically', async () => {
    mockGetNextSequence.mockRejectedValueOnce(new Error('counter unavailable'));
    GameModel.findOne.mockReturnValueOnce({ sort: () => ({ select: async () => ({ gameId: 41 }) }) });
    const result = await makeManager().getNextGameId();
    expect(result).toBe(42);
    expect(mockCounterUpdateOne).toHaveBeenCalledWith({ _id: 'gameId' }, { $max: { seq: 42 } }, { upsert: true });
  });
});

describe('retryWarp safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function pendingGame(state = 'pending') {
    return {
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ gameId: 1, state }),
    };
  }

  function activeWarp(manager: GameManager, overrides: Record<string, unknown> = {}) {
    const data: any = {
      gameId: '1',
      timeout: setTimeout(() => undefined, 60000),
      attempts: 0,
      team1IGNs: ['A'],
      team2IGNs: ['B'],
      map: 'MapA',
      isRanked: true,
      timestamp: Date.now(),
      ...overrides,
    };
    (manager as any).warpRequests.set('1', data);
    return data;
  }

  it('sends an active warp retry and enforces the per-game cooldown', async () => {
    const manager = makeManager();
    activeWarp(manager);
    GameModel.findOne.mockReturnValue(pendingGame());

    try {
      const result = await manager.retryWarp(1);
      expect(result).toEqual({ attempts: 1, maxAttempts: 3 });
      expect(wsManagerMock.send).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warp_players',
        game_id: '1',
        map: 'MapA',
      }));

      await expect(manager.retryWarp(1)).rejects.toThrow(/Please wait \d+s/);
    } finally {
      manager.cleanup();
    }
  });

  it('rejects retries without an active warp request', async () => {
    const manager = makeManager();
    await expect(manager.retryWarp(1)).rejects.toThrow('No active warp request');
  });

  it('rejects retries once the game is no longer pending', async () => {
    const manager = makeManager();
    activeWarp(manager);
    GameModel.findOne.mockReturnValue(pendingGame('scored'));

    try {
      await expect(manager.retryWarp(1)).rejects.toThrow('can no longer be retried');
    } finally {
      manager.cleanup();
    }
  });

  it('rejects overlapping retries', async () => {
    const manager = makeManager();
    activeWarp(manager, { retrying: true });

    try {
      await expect(manager.retryWarp(1)).rejects.toThrow('already in progress');
    } finally {
      manager.cleanup();
    }
  });

  it('consumes only one retry for duplicate failure events from the same attempt', async () => {
    const manager = makeManager();
    (manager as any).WARP_RETRY_DELAY = 10;
    const warp = activeWarp(manager, { sentAttempt: 1, handledFailureAttempt: 0 });

    try {
      await (manager as any).handleWarpFailure('1', 'Arena not found');
      await (manager as any).handleWarpFailure('1', 'Unknown warp failure');

      expect(warp.attempts).toBe(1);
      expect(wsManagerMock.send).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 30));
      expect(wsManagerMock.send).toHaveBeenCalledTimes(1);
      expect(warp.sentAttempt).toBe(2);
    } finally {
      manager.cleanup();
    }
  });

  it('does not send a scheduled retry after the game is cleaned up', async () => {
    const manager = makeManager();
    (manager as any).WARP_RETRY_DELAY = 20;
    activeWarp(manager, { sentAttempt: 1, handledFailureAttempt: 0 });

    await (manager as any).handleWarpFailure('1', 'Arena not found');
    manager.cleanup();

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(wsManagerMock.send).not.toHaveBeenCalled();
  });
});
