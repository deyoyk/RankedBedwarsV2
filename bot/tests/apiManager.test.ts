import { ApiManager } from '../src/api/ApiManager';
import { queuePlayers } from '../src/types/queuePlayersMemory';
import { AddressInfo } from 'net';

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue([])
  }
}));
jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { find: jest.fn() }
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: jest.fn() }
}));
jest.mock('../src/models/Season', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn() }
}));
jest.mock('../src/models/SeasonStats', () => ({
  __esModule: true,
  default: { find: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0) }
}));
jest.mock('../src/models/SeasonGames', () => ({
  __esModule: true,
  default: { find: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0) }
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn(), countDocuments: jest.fn().mockResolvedValue(0) }
}));
jest.mock('../src/managers/SeasonManager', () => ({
  SeasonManager: {
    getCurrentSeason: jest.fn().mockResolvedValue(null),
    getSeason: jest.fn().mockResolvedValue(null),
    getUserSeasonStats: jest.fn().mockResolvedValue(null),
    getSeasonGames: jest.fn().mockResolvedValue({ games: [], total: 0, totalPages: 0 }),
    getSeasonLeaderboard: jest.fn().mockResolvedValue({ entries: [], total: 0, totalPages: 0 })
  }
}));
jest.mock('../src/websocket/WebSocketManager', () => ({
  __esModule: true,
  WebSocketManager: class {}
}));

const UserModel = require('../src/models/User').default;
const QueueModel = require('../src/models/Queue').default;
const SeasonStatsModel = require('../src/models/SeasonStats').default;
const GameModel = require('../src/models/Game').default;

const servers: any[] = [];

function mockQuery(valueOrFn: any): any {
  const chain: any = {};
  const resolve = () => (typeof valueOrFn === 'function' ? valueOrFn() : valueOrFn);
  chain.select = () => chain;
  chain.sort = () => chain;
  chain.skip = () => chain;
  chain.limit = () => chain;
  chain.lean = async () => resolve();
  chain.then = (onFulfilled: any, onRejected?: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return chain;
}

function makeManager(): { manager: ApiManager; app: any } {
  const app = express();
  const wsManager: any = {
    app,
    send: jest.fn(),
    getAllMaps: () => [],
    getReservedMaps: () => [],
    getLockedMaps: () => [],
    getDisabledMaps: () => []
  };
  const client: any = { guilds: { cache: { first: () => undefined } } };
  return { manager: new ApiManager(client, wsManager), app };
}

async function boot(app: any): Promise<string> {
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function makeUserDoc(overrides: any = {}) {
  return {
    _id: 'user-1',
    discordId: '1001',
    ign: 'PlayerOne',
    elo: 1500,
    peakElo: 1600,
    level: 1,
    experience: 0,
    wins: 10,
    losses: 5,
    games: 15,
    mvps: 3,
    kills: 100,
    deaths: 50,
    finalKills: 20,
    finalDeaths: 10,
    bedBroken: 7,
    diamonds: 5,
    irons: 10,
    gold: 15,
    emeralds: 20,
    blocksPlaced: 100,
    winstreak: 2,
    losestreak: 0,
    kdr: 2,
    wlr: 2,
    playtimeSeconds: 3600,
    ismuted: false,
    isbanned: false,
    isfrozen: false,
    settings: {},
    recentGames: [],
    dailyElo: [],
    strikes: [],
    mutes: [],
    bans: [],
    ...overrides
  };
}

function makeRecentGame(gameId: number) {
  return {
    gameId,
    map: 'Aquarius',
    eloGain: 30,
    oldElo: 1000,
    newElo: 1030,
    kills: 5,
    deaths: 2,
    bedBroken: 1,
    finalKills: 1,
    won: true,
    ismvp: false,
    date: new Date(),
    state: 'scored',
    startTime: new Date(),
    diamonds: 1,
    irons: 2,
    gold: 3,
    emeralds: 4,
    blocksPlaced: 10
  };
}

describe('ApiManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queuePlayers.clear();
    delete process.env.RBW_RATE_LIMIT_MAX;
    delete process.env.RBW_RATE_LIMIT_STRICT_MAX;
  });

  afterAll(() => {
    for (const server of servers) server.close();
  });

  it('GET /rbw/api/user?discordid= returns stats including the new fields', async () => {
    UserModel.findOne.mockImplementation(() => mockQuery(makeUserDoc()));
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api/user?discordid=1001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.discordId).toBe('1001');
    expect(body.finalDeaths).toBe(10);
    expect(body.playtimeSeconds).toBe(3600);
    expect(body.peakElo).toBe(1600);
    expect(body.levelInfo.level).toBe(1);
    expect(UserModel.findOne).toHaveBeenCalledWith({ discordId: '1001' });
  });

  it('GET /rbw/api/user/:discordid/overview returns the combined payload', async () => {
    const recentGames = Array.from({ length: 12 }, (_, i) => makeRecentGame(i + 1));
    UserModel.findOne.mockImplementation(() =>
      mockQuery(makeUserDoc({
        experience: 250,
        recentGames,
        dailyElo: [{ elo: 1500, date: new Date() }]
      }))
    );
    SeasonStatsModel.find.mockImplementation(() => mockQuery([
      {
        seasonNumber: 2, chapterNumber: 1, elo: 1400, wins: 8, losses: 4, games: 12,
        kills: 60, deaths: 30, mvps: 2, bedBroken: 5, finalDeaths: 6,
        playtimeSeconds: 1800, peakElo: 1400, level: 3, experience: 225
      },
      {
        seasonNumber: 1, chapterNumber: 1, elo: 1000, wins: 2, losses: 1, games: 3,
        kills: 10, deaths: 10, mvps: 1, bedBroken: 1, finalDeaths: 2,
        playtimeSeconds: 600, peakElo: 1000, level: 2, experience: 100
      }
    ]));
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api/user/1001/overview`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.discordId).toBe('1001');
    expect(body.profile.finalDeaths).toBe(10);
    expect(body.profile.playtimeSeconds).toBe(3600);
    expect(body.profile.peakElo).toBe(1600);
    expect(body.profile.winRate).toBe('66.7%');
    expect(body.profile.kdr).toBe('2.00');
    expect(body.recentGames).toHaveLength(10);
    expect(body.dailyElo).toHaveLength(1);
    expect(body.level.level).toBe(3);
    expect(body.currentStreak).toEqual({ winstreak: 2, losestreak: 0 });
    expect(body.seasonHistory.totalSeasons).toBe(2);
    expect(body.seasonHistory.seasons[0].season).toBe(2);
    expect(body.seasonHistory.seasons[0].peakElo).toBe(1400);
  });

  it('GET /rbw/api/game/:gameid/timeline returns the timeline plus game metadata', async () => {
    const timeline = [
      { type: 'final_kill', player: 'A', target: 'C', timestamp: 1000 },
      { type: 'bed_broken', player: 'C', timestamp: 2000 },
      { type: 'kill', player: 'B', amount: 1, timestamp: 3000 }
    ];
    GameModel.findOne.mockImplementation(() => mockQuery({
      gameId: 42,
      map: 'Aquarius',
      state: 'scored',
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T00:30:00Z'),
      winners: ['A', 'B'],
      losers: ['C', 'D'],
      timeline
    }));
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api/game/42/timeline`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gameId).toBe(42);
    expect(body.map).toBe('Aquarius');
    expect(body.state).toBe('scored');
    expect(body.winners).toEqual(['A', 'B']);
    expect(body.losers).toEqual(['C', 'D']);
    expect(body.timeline).toHaveLength(3);
    expect(body.timeline[0]).toEqual({ type: 'final_kill', player: 'A', target: 'C', timestamp: 1000 });
  });

  it('hammering an endpoint repeatedly triggers the 429 rate limit', async () => {
    process.env.RBW_RATE_LIMIT_MAX = '5';
    QueueModel.find.mockImplementation(() => mockQuery([]));
    const { app } = makeManager();
    const base = await boot(app);

    let ok = 0;
    let limited = 0;
    let limitedBody: any = null;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${base}/rbw/api/queues`);
      if (res.status === 200) ok++;
      if (res.status === 429) {
        limited++;
        limitedBody = await res.json();
      }
    }

    expect(ok).toBeGreaterThanOrEqual(1);
    expect(limited).toBeGreaterThanOrEqual(1);
    expect(limitedBody).toEqual({ error: 'Too many requests, slow down' });
  });

  it('advertised endpoint list includes new endpoints and drops the knockback stubs', async () => {
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('online');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.version).toBe(require('../package.json').version);
    expect(body.endpoints).toContain('/rbw/api/user/:discordid/overview');
    expect(body.endpoints).toContain('/rbw/api/game/:gameid/timeline');
    expect(body.endpoints).not.toContain('/rbw/api/knockback/votes');
    expect(body.endpoints).not.toContain('/rbw/api/knockback/vote');
  });

  it('serves the RBW_WEB_DIR ui and exposes /rbw/web/config without auth', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbw-web-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><title>Ranked Bedwars Fixture</title></head><body>hi</body></html>');
    fs.writeFileSync(path.join(dir, 'styles.css'), 'body { color: red; }');
    const prev = process.env.RBW_WEB_DIR;
    process.env.RBW_WEB_DIR = dir;
    try {
      const { app } = makeManager();
      const base = await boot(app);

      const index = await fetch(`${base}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('Ranked Bedwars Fixture');

      const asset = await fetch(`${base}/styles.css`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type') || '').toContain('text/css');

      const configRes = await fetch(`${base}/rbw/web/config`);
      expect(configRes.status).toBe(200);
      const config = await configRes.json();
      expect(config.apiBase).toBe('');
      expect(typeof config.apiKeyRequired).toBe('boolean');
    } finally {
      if (prev === undefined) delete process.env.RBW_WEB_DIR;
      else process.env.RBW_WEB_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GET /rbw/api/muteinfo tolerates string dates', async () => {
    UserModel.findOne.mockImplementation(() => mockQuery(makeUserDoc({
      ismuted: true,
      mutes: [{ id: 'm1', date: '2020-01-01T00:00:00.000Z', duration: 60, reason: 'old' }]
    })));
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api/muteinfo?discordid=1001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toBeNull();
    expect(body.history).toHaveLength(1);
  });

  it('GET /rbw/api/muteinfo flags an active string-dated mute', async () => {
    UserModel.findOne.mockImplementation(() => mockQuery(makeUserDoc({
      ismuted: true,
      mutes: [{ id: 'm2', date: new Date(Date.now() + 3600000).toISOString(), duration: 120, reason: 'active' }]
    })));
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api/muteinfo?discordid=1001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).toMatchObject({ id: 'm2' });
  });

  it('GET /rbw/api/punishments/mutes sorts mixed Date and string dates', async () => {
    UserModel.find.mockImplementation((query: any) => {
      if (query?.discordId?.$in) {
        return mockQuery([
          { discordId: '1001', ign: 'PlayerOne' },
          { discordId: 'mod1', ign: 'Mod' }
        ]);
      }
      return mockQuery([makeUserDoc({
        mutes: [
          { id: 'old', date: '2020-01-01T00:00:00.000Z', duration: 0, reason: 'old', moderator: 'mod1' },
          { id: 'new', date: new Date(Date.now() + 3600000), duration: 0, reason: 'new', moderator: 'mod1' }
        ]
      })]);
    });
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api/punishments/mutes`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.punishments;
    expect(list.map((p: any) => p.id)).toEqual(['new', 'old']);
  });

  it('GET /rbw/api/user reports a numeric progress percentage', async () => {
    UserModel.findOne.mockImplementation(() => mockQuery(makeUserDoc({ experience: 250 })));
    const { app } = makeManager();
    const base = await boot(app);

    const res = await fetch(`${base}/rbw/api/user?discordid=1001`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.levelInfo.progressPercentage).toMatch(/^\d+\.\d{2}$/);
  });
});
