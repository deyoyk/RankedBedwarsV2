import {
  parseTiers,
  streakBonusFor,
  bountyForOpponentStreak,
  decayAmountForElo,
  isDecayProtected,
} from '../src/utils/eloProgression';
import { GameManager } from '../src/Matchmaking/GameManager';

const STREAK_FALLBACK = [{ threshold: 10, bonus: 5 }];
const DAY = 24 * 60 * 60 * 1000;

describe('parseTiers', () => {
  it('parses pairs and sorts ascending', () => {
    expect(parseTiers('20:15,10:5,15:10', [])).toEqual([
      { threshold: 10, bonus: 5 },
      { threshold: 15, bonus: 10 },
      { threshold: 20, bonus: 15 },
    ]);
  });
  it('falls back on empty or garbage input', () => {
    expect(parseTiers('', STREAK_FALLBACK)).toEqual(STREAK_FALLBACK);
    expect(parseTiers(undefined, STREAK_FALLBACK)).toEqual(STREAK_FALLBACK);
    expect(parseTiers('abc,0:-5,10:x', STREAK_FALLBACK)).toEqual(STREAK_FALLBACK);
  });
  it('keeps valid pairs and drops invalid ones', () => {
    expect(parseTiers('5:5,junk,10:10', [])).toEqual([
      { threshold: 5, bonus: 5 },
      { threshold: 10, bonus: 10 },
    ]);
  });
});

describe('streakBonusFor', () => {
  const tiers = parseTiers('10:5,15:10,20:15', []);
  it('pays the milestone only on exact hit', () => {
    expect(streakBonusFor(10, tiers)).toBe(5);
    expect(streakBonusFor(15, tiers)).toBe(10);
    expect(streakBonusFor(20, tiers)).toBe(15);
  });
  it('pays nothing between or below milestones', () => {
    expect(streakBonusFor(9, tiers)).toBe(0);
    expect(streakBonusFor(11, tiers)).toBe(0);
    expect(streakBonusFor(16, tiers)).toBe(0);
    expect(streakBonusFor(21, tiers)).toBe(0);
    expect(streakBonusFor(0, tiers)).toBe(0);
  });
});

describe('bountyForOpponentStreak', () => {
  const tiers = parseTiers('5:5,10:10,15:15,25:20', []);
  it('pays the best tier at or below the opponent streak', () => {
    expect(bountyForOpponentStreak(5, tiers)).toBe(5);
    expect(bountyForOpponentStreak(12, tiers)).toBe(10);
    expect(bountyForOpponentStreak(24, tiers)).toBe(15);
    expect(bountyForOpponentStreak(99, tiers)).toBe(20);
  });
  it('pays nothing when nobody qualifies', () => {
    expect(bountyForOpponentStreak(4, tiers)).toBe(0);
    expect(bountyForOpponentStreak(0, tiers)).toBe(0);
  });
});

describe('decayAmountForElo', () => {
  const bands = [
    { minElo: 800, maxElo: 1199, amount: 35 },
    { minElo: 1200, maxElo: Number.MAX_SAFE_INTEGER, amount: 60 },
  ];
  it('applies band amounts with boundaries inclusive', () => {
    expect(decayAmountForElo(800, bands)).toBe(35);
    expect(decayAmountForElo(1199, bands)).toBe(35);
    expect(decayAmountForElo(1200, bands)).toBe(60);
    expect(decayAmountForElo(5000, bands)).toBe(60);
  });
  it('returns zero below the lowest band', () => {
    expect(decayAmountForElo(799, bands)).toBe(0);
    expect(decayAmountForElo(0, bands)).toBe(0);
  });
});

describe('isDecayProtected', () => {
  const now = new Date('2026-11-02T00:00:00Z');
  it('protects accounts inside the grace window', () => {
    expect(isDecayProtected(new Date(now.getTime() - 4 * DAY), now, 5)).toBe(true);
  });
  it('expires protection at the boundary', () => {
    expect(isDecayProtected(new Date(now.getTime() - 5 * DAY), now, 5)).toBe(false);
    expect(isDecayProtected(new Date(now.getTime() - 30 * DAY), now, 5)).toBe(false);
  });
  it('never protects without a date or with zero grace', () => {
    expect(isDecayProtected(undefined, now, 5)).toBe(false);
    expect(isDecayProtected(new Date(), now, 0)).toBe(false);
  });
});

const mockSave = jest.fn().mockImplementation(() => Promise.resolve());

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
    channels: { text: 'text-1' },
    save: mockSave,
  };
}

function makeUser(id: string, elo = 1000, winStreak = 0) {
  return {
    discordId: id,
    ign: id.toUpperCase(),
    elo,
    wins: 0, losses: 0, games: 0, mvps: 0,
    kills: 0, deaths: 0, finalKills: 0, bedBroken: 0,
    diamonds: 0, irons: 0, gold: 0, emeralds: 0, blocksPlaced: 0,
    winStreak, loseStreak: 0, experience: 0, level: 1,
    kdr: 0, wlr: 0,
    recentGames: [],
    dailyElo: [],
    save: mockSave,
  };
}

const makeRank = () => ({
  roleId: 'rank-1', startElo: 0, endElo: 99999,
  winElo: 30, loseElo: 20, mvpElo: 10, bedElo: 5,
});

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn(), updateMany: jest.fn().mockResolvedValue({}), bulkWrite: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: {} }));
jest.mock('../src/models/Counter', () => ({
  getNextSequence: jest.fn().mockResolvedValue(100),
  Counter: {},
}));
jest.mock('../src/utils/scoreImage', () => ({
  generateScoreImageBuffer: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/utils/fix', () => ({
  fix: jest.fn().mockResolvedValue(undefined),
  safeFix: jest.fn().mockResolvedValue(undefined),
  getEloRanks: jest.fn(),
}));
jest.mock('../src/utils/userStats', () => {
  const actual = jest.requireActual('../src/utils/userStats');
  return { ...actual, updateDailyElo: jest.fn() };
});
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
const clientMock = { guilds: { cache: { first: jest.fn().mockReturnValue(undefined) } } };

function setupGame(players: any[]) {
  const gameDoc = makeGameDoc();
  GameModel.findOne.mockImplementation(async () => gameDoc);
  GameModel.findOneAndUpdate.mockImplementation(async () => gameDoc);
  UserModel.find.mockImplementation(async () => players);
  UserModel.findOne.mockImplementation(async ({ discordId }: any) =>
    players.find((p: any) => p.discordId === discordId) || null
  );
  EloRankModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([makeRank()]) });
  mockSave.mockClear();
}

describe('scoreGame progression bonuses', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pays the streak milestone when a winner reaches it', async () => {
    const players = [makeUser('a', 1000, 9), makeUser('b', 1000, 0), makeUser('c', 1000, 0), makeUser('d', 1000, 0)];
    setupGame(players);
    const manager = new GameManager(clientMock as any, wsManagerMock as any);
    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: ['A'], bedbreaks: [] });
    expect(players[0].elo).toBe(1000 + 30 + 10 + 5);
    expect(players[0].winStreak).toBe(10);
    expect(players[1].elo).toBe(1000 + 30);
  });

  it('pays no streak bonus below a milestone', async () => {
    const players = [makeUser('a', 1000, 4), makeUser('b', 1000, 0), makeUser('c', 1000, 0), makeUser('d', 1000, 0)];
    setupGame(players);
    const manager = new GameManager(clientMock as any, wsManagerMock as any);
    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [] });
    expect(players[0].elo).toBe(1000 + 30);
  });

  it('pays a bounty to winners beating a hot-streak opponent', async () => {
    const players = [makeUser('a', 1000, 0), makeUser('b', 1000, 0), makeUser('c', 1000, 7), makeUser('d', 1000, 0)];
    setupGame(players);
    const manager = new GameManager(clientMock as any, wsManagerMock as any);
    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [] });
    expect(players[0].elo).toBe(1000 + 30 + 5);
    expect(players[1].elo).toBe(1000 + 30 + 5);
    expect(players[2].elo).toBe(1000 - 20);
  });

  it('pays no bounty when losers have no streak', async () => {
    const players = [makeUser('a', 1000, 3), makeUser('b', 1000, 0), makeUser('c', 1000, 2), makeUser('d', 1000, 0)];
    setupGame(players);
    const manager = new GameManager(clientMock as any, wsManagerMock as any);
    await manager.scoreGame({ gameId: 1, winningTeam: 1, mvps: [], bedbreaks: [] });
    expect(players[0].elo).toBe(1000 + 30);
  });

  it('stamps lastPlayedAt on every participant', async () => {
    const players = [makeUser('a'), makeUser('b'), makeUser('c'), makeUser('d')];
    setupGame(players);
    const manager = new GameManager(clientMock as any, wsManagerMock as any);
    const before = Date.now();
    await manager.scoreGame({ gameId: 1, winningTeam: 2, mvps: [], bedbreaks: [] });
    for (const p of players) {
      const stamped = p as unknown as { lastPlayedAt: unknown };
      expect(stamped.lastPlayedAt instanceof Date).toBe(true);
      expect((stamped.lastPlayedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    }
  });
});

describe('ranks command progression sections', () => {
  it('shows only ranks and none of the bonus/decay sections', async () => {
    const { ranks } = await import('../src/commands/general/ranks');
    const { getEloRanks } = require('../src/utils/fix');
    getEloRanks.mockResolvedValue([{ roleId: '123456789012345678', startElo: 0, endElo: 999, winElo: 10, loseElo: 5, mvpElo: 2, bedElo: 1 }]);
    const reply = jest.fn().mockResolvedValue({});
    await ranks({ reply } as any, [], undefined);
    expect(reply).toHaveBeenCalled();
    const text = JSON.stringify(reply.mock.calls[0][0]);
    expect(text).toContain('123456789012345678');
    expect(text).not.toMatch(/Decay/);
    expect(text).not.toMatch(/Win Streak Bonuses/);
    expect(text).not.toMatch(/Bounties/);
  });
});

describe('EloDecayTask', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decays inactive users per band and skips the rest', async () => {
    const { EloDecayTask } = await import('../src/tasks/EloDecayTask');
    const now = new Date('2026-11-02T00:00:00Z');
    const old = new Date(now.getTime() - 10 * DAY);
    const recent = new Date(now.getTime() - 1 * DAY);
    const fresh = new Date(now.getTime() - 1 * DAY);
    const batch = [
      { _id: 1, discordId: 'u1', elo: 900, lastPlayedAt: old, createdAt: old, dailyElo: [] },
      { _id: 2, discordId: 'u2', elo: 1500, lastPlayedAt: old, createdAt: old, dailyElo: [] },
      { _id: 3, discordId: 'u3', elo: 700, lastPlayedAt: old, createdAt: old, dailyElo: [] },
      { _id: 4, discordId: 'u4', elo: 900, lastPlayedAt: recent, createdAt: old, dailyElo: [] },
      { _id: 5, discordId: 'u5', elo: 900, lastPlayedAt: old, createdAt: fresh, dailyElo: [] },
      { _id: 6, discordId: 'u6', elo: 810, lastPlayedAt: undefined, updatedAt: old, createdAt: old, dailyElo: [] },
    ];
    const UserMock = require('../src/models/User').default;
    UserMock.find.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(batch) }),
    }));
    const task = new EloDecayTask({} as any);
    const result = await task.applyDecay(now);
    expect(result.decayed).toBe(3);
    expect(result.totalLost).toBe(35 + 60 + 35);
    expect(UserMock.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = UserMock.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(3);
  });

  it('does nothing when disabled', async () => {
    const config = (await import('../src/config/config')).default as any;
    const prev = config.eloDecay.enabled;
    config.eloDecay.enabled = false;
    try {
      const { EloDecayTask } = await import('../src/tasks/EloDecayTask');
      const task = new EloDecayTask({} as any);
      await expect(task.applyDecay(new Date('2026-11-02T00:00:00Z'))).resolves.toEqual({ decayed: 0, totalLost: 0 });
    } finally {
      config.eloDecay.enabled = prev;
    }
  });
});
