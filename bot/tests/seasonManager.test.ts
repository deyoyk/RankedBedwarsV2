import { SeasonManager } from '../src/managers/SeasonManager';

jest.mock('mongoose', () => ({
  __esModule: true,
  default: { startSession: jest.fn() }
}));
jest.mock('../src/models/Season', () => {
  const C: any = jest.fn().mockImplementation((doc: any) => ({
    ...doc,
    save: jest.fn().mockResolvedValue(undefined)
  }));
  C.findOne = jest.fn();
  return { __esModule: true, default: C };
});
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn(), updateMany: jest.fn().mockResolvedValue({}) }
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({})
  }
}));

const createdStats: any[] = [];
const createdGames: any[] = [];
let activeSaves = 0;
let maxActiveSaves = 0;

function trackingSave() {
  return async () => {
    activeSaves++;
    maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
    await new Promise(r => setTimeout(r, 1));
    activeSaves--;
  };
}

jest.mock('../src/models/SeasonStats', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((doc: any) => {
    createdStats.push(doc);
    return { save: trackingSave() };
  })
}));
jest.mock('../src/models/SeasonGames', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((doc: any) => {
    createdGames.push(doc);
    return { save: trackingSave() };
  })
}));

const mongoose = require('mongoose').default;
const SeasonModel = require('../src/models/Season').default;
const UserModel = require('../src/models/User').default;
const GameModel = require('../src/models/Game').default;

function makeUser(i: number) {
  return {
    discordId: `u${i}`, ign: `U${i}`, elo: 1000 + i,
    level: 5, experience: 500, wins: 10, losses: 5, games: 15, mvps: 2,
    kills: 50, deaths: 25, bedBroken: 3, finalKills: 4, finalDeaths: 1,
    diamonds: 1, irons: 2, gold: 3, emeralds: 4, blocksPlaced: 100,
    winStreak: 1, loseStreak: 0, kdr: 2, wlr: 2, playtimeSeconds: 600,
    peakElo: 1100, recentGames: [], dailyElo: []
  };
}

function makeGame(i: number) {
  return {
    toObject: () => ({
      _id: `g${i}`, __v: 0, gameId: i, map: 'Aquarius',
      team1: ['u0'], team2: ['u1'], state: 'scored'
    })
  };
}

describe('SeasonManager.endSeason', () => {
  it('migrates all users and games with bounded write concurrency', async () => {
    const users = Array.from({ length: 250 }, (_, i) => makeUser(i));
    const games = Array.from({ length: 50 }, (_, i) => makeGame(i));
    const activeSeason: any = {
      seasonNumber: 2, chapterNumber: 1, name: 'S2',
      isActive: true, save: jest.fn().mockResolvedValue(undefined)
    };
    const session: any = {
      withTransaction: async (fn: any) => fn(),
      endSession: jest.fn().mockResolvedValue(undefined)
    };
    mongoose.startSession.mockResolvedValue(session);
    SeasonModel.findOne.mockReturnValue({ session: async () => activeSeason });
    UserModel.find.mockReturnValue({ session: async () => users });
    GameModel.find.mockReturnValue({ session: async () => games });

    const result = await SeasonManager.endSeason();

    expect(result.success).toBe(true);
    expect(result.usersMigrated).toBe(250);
    expect(result.gamesMigrated).toBe(50);
    expect(result.statsCreated).toBe(250);
    expect(createdStats).toHaveLength(250);
    expect(createdGames).toHaveLength(50);
    expect(createdStats[0]).toMatchObject({ seasonNumber: 2, chapterNumber: 1, discordId: 'u0' });
    expect(createdGames[0]).toMatchObject({ seasonNumber: 2, chapterNumber: 1, gameId: 0 });
    expect(createdGames[0]).not.toHaveProperty('_id');
    expect(activeSeason.isActive).toBe(false);
    expect(maxActiveSaves).toBeLessThanOrEqual(100);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('fails cleanly with no active season', async () => {
    const session: any = {
      withTransaction: async (fn: any) => fn(),
      endSession: jest.fn().mockResolvedValue(undefined)
    };
    mongoose.startSession.mockResolvedValue(session);
    SeasonModel.findOne.mockReturnValue({ session: async () => null });

    await expect(SeasonManager.endSeason()).rejects.toThrow('No active season');
    expect(session.endSession).toHaveBeenCalled();
  });
});

describe('SeasonManager.startSeason', () => {
  const SeasonModelCtor = require('../src/models/Season').default;
  const UserModel = require('../src/models/User').default;
  const GameModel = require('../src/models/Game').default;

  it('stamps the season inside one transaction', async () => {
    const session: any = {
      withTransaction: async (fn: any) => fn(),
      endSession: jest.fn().mockResolvedValue(undefined)
    };
    mongoose.startSession.mockResolvedValue(session);
    SeasonModelCtor.findOne.mockResolvedValue(null);

    const result = await SeasonManager.startSeason({ seasonNumber: 3, chapterNumber: 1, name: 'S3' });

    expect(result.success).toBe(true);
    const created = SeasonModelCtor.mock.results[0].value;
    expect(created.seasonNumber).toBe(3);
    expect(created.save).toHaveBeenCalledWith({ session });
    expect(UserModel.updateMany).toHaveBeenCalledWith(
      {}, { seasonNumber: 3, chapterNumber: 1 }, { session });
    expect(GameModel.updateMany).toHaveBeenCalledWith(
      {}, { seasonNumber: 3, chapterNumber: 1 }, { session });
    expect(session.endSession).toHaveBeenCalled();
  });

  it('refuses when a season is already active without touching the database writes', async () => {
    SeasonModelCtor.findOne.mockResolvedValue({ name: 'S2', seasonNumber: 2, chapterNumber: 1 });
    SeasonModelCtor.mockClear();

    const result = await SeasonManager.startSeason({ seasonNumber: 3, chapterNumber: 1, name: 'S3' });

    expect(result.success).toBe(false);
    expect(SeasonModelCtor).not.toHaveBeenCalled();
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('reports failure when stamping fails', async () => {
    const session: any = {
      withTransaction: async (fn: any) => fn(),
      endSession: jest.fn().mockResolvedValue(undefined)
    };
    mongoose.startSession.mockResolvedValue(session);
    SeasonModelCtor.findOne.mockResolvedValue(null);
    GameModel.updateMany.mockRejectedValueOnce(new Error('db down'));

    const result = await SeasonManager.startSeason({ seasonNumber: 3, chapterNumber: 1, name: 'S3' });

    expect(result.success).toBe(false);
    expect(session.endSession).toHaveBeenCalled();
  });
});
