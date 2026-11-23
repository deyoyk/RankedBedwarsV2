import { ApiManager } from '../src/api/ApiManager';
import { PublicApiManager } from '../src/api/PublicApiManager';
import { AddressInfo } from 'net';

const express = require('express');

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

function makeApp(): { app: any; wsManager: any; client: any } {
  const app = express();
  const wsManager: any = {
    app,
    send: jest.fn(),
    getAllMaps: () => [],
    getReservedMaps: () => [],
    getLockedMaps: () => [],
    getDisabledMaps: () => [],
    getServerStats: () => null
  };
  const client: any = { guilds: { cache: { first: () => undefined } } };
  return { app, wsManager, client };
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
    experience: 0,
    wins: 10,
    losses: 5,
    games: 15,
    kills: 100,
    deaths: 50,
    recentGames: [],
    dailyElo: [],
    strikes: [],
    mutes: [],
    bans: [],
    ...overrides
  };
}

describe('PublicApiManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_KEY = 'secret';
    delete process.env.RBW_PUBLIC_RATE_LIMIT_MAX;
    delete process.env.RBW_PUBLIC_RATE_LIMIT_STRICT_MAX;
  });

  afterAll(() => {
    process.env.AUTH_KEY = '';
    delete process.env.RBW_PUBLIC_RATE_LIMIT_MAX;
    delete process.env.RBW_PUBLIC_RATE_LIMIT_STRICT_MAX;
    for (const server of servers) server.close();
  });

  it('serves the website endpoints publicly while the private API stays protected', async () => {
    UserModel.findOne.mockImplementation(() => mockQuery(makeUserDoc()));
    SeasonStatsModel.find.mockImplementation(() => mockQuery([]));
    const { app, wsManager, client } = makeApp();
    new ApiManager(client, wsManager);
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    const publicRes = await fetch(`${base}/public/rbw/api/user/1001/overview`);
    expect(publicRes.status).toBe(200);
    const publicBody = await publicRes.json();
    expect(publicBody.profile.discordId).toBe('1001');
    expect(publicBody.profile.ign).toBe('PlayerOne');
    expect(publicBody.profile.levelInfo.level).toBe(1);

    const privateRes = await fetch(`${base}/rbw/api/user?discordid=1001`);
    expect(privateRes.status).toBe(401);
    await expect(privateRes.text()).resolves.toBe('');
  });

  it('returns an HTML notice at the public API root', async () => {
    const { app, wsManager, client } = makeApp();
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    const res = await fetch(`${base}/public/rbw/api`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    await expect(res.text()).resolves.toBe("your'e gay and deyo is the goat");
  });

  it('does not expose endpoints the website does not use', async () => {
    const { app, wsManager, client } = makeApp();
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    for (const path of ['/user', '/queues', '/server/status', '/stats/global', '/maps']) {
      const res = await fetch(`${base}/public/rbw/api${path}`);
      expect(res.status).toBe(404);
    }
  });

  it('serves game timelines publicly with event details', async () => {
    const GameModel = require('../src/models/Game').default;
    GameModel.findOne.mockImplementation(() => mockQuery({
      gameId: 7,
      map: 'MapA',
      state: 'scored',
      startTime: new Date(),
      endTime: new Date(),
      winners: ['A'],
      losers: ['B'],
      timeline: [
        { type: 'upgrade', player: 'A', team: 'RED', amount: 2, detail: 'Sharpened Swords II', timestamp: 1000 }
      ]
    }));
    const { app, wsManager, client } = makeApp();
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    const res = await fetch(`${base}/public/rbw/api/game/7/timeline`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gameId).toBe(7);
    expect(body.timeline[0].detail).toBe('Sharpened Swords II');
    expect(body.timeline[0].amount).toBe(2);
  });

  it('rejects non-numeric game ids without querying the database', async () => {
    const GameModel = require('../src/models/Game').default;
    GameModel.findOne.mockClear();
    const { app, wsManager, client } = makeApp();
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    for (const id of ['abc', 'NaN', '0', '-1']) {
      const res = await fetch(`${base}/public/rbw/api/game/${id}`);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'gameid must be a positive integer' });
    }
    expect(GameModel.findOne).not.toHaveBeenCalled();
  });

  it('rate limits public requests per IP without consuming the private API limit', async () => {
    process.env.RBW_PUBLIC_RATE_LIMIT_MAX = '2';
    process.env.RBW_PUBLIC_RATE_LIMIT_STRICT_MAX = '100';
    UserModel.find.mockImplementation(() => mockQuery([]));
    QueueModel.find.mockImplementation(() => mockQuery([]));
    const { app, wsManager, client } = makeApp();
    new ApiManager(client, wsManager);
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    let ok = 0;
    let limited = 0;
    let limitedBody: any = null;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/public/rbw/api/online-players`);
      if (res.status === 200) ok++;
      if (res.status === 429) {
        limited++;
        limitedBody = await res.json();
      }
    }

    expect(ok).toBe(2);
    expect(limited).toBe(3);
    expect(limitedBody).toEqual({ error: 'Too many requests, slow down' });

    const privateRes = await fetch(`${base}/rbw/api/queues?key=secret`);
    expect(privateRes.status).toBe(200);
  });
});
