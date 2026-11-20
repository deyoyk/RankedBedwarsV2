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
    getDisabledMaps: () => []
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

  it('serves public routes without an auth key while the private API stays protected', async () => {
    UserModel.findOne.mockImplementation(() => mockQuery(makeUserDoc()));
    const { app, wsManager, client } = makeApp();
    new ApiManager(client, wsManager);
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    const publicRes = await fetch(`${base}/public/rbw/api/user?discordid=1001`);
    expect(publicRes.status).toBe(200);
    const publicBody = await publicRes.json();
    expect(publicBody.discordId).toBe('1001');
    expect(publicBody.ign).toBe('PlayerOne');
    expect(publicBody.levelInfo.level).toBe(1);

    const privateRes = await fetch(`${base}/rbw/api/user?discordid=1001`);
    expect(privateRes.status).toBe(401);
    await expect(privateRes.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('advertises the public endpoint list at /public/rbw/api', async () => {
    const { app, wsManager, client } = makeApp();
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    const res = await fetch(`${base}/public/rbw/api`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('online');
    expect(body.note).toContain('/public/rbw/api/user/:discordid/overview');
    expect(body.endpoints).toContain('/public/rbw/api/user/:discordid/overview');
    expect(body.endpoints).toContain('/public/rbw/api/game/:gameid/timeline');
    expect(body.endpoints.every((endpoint: string) => endpoint.startsWith('/public/rbw/api'))).toBe(true);
  });

  it('rate limits public requests per IP without consuming the private API limit', async () => {
    process.env.RBW_PUBLIC_RATE_LIMIT_MAX = '2';
    process.env.RBW_PUBLIC_RATE_LIMIT_STRICT_MAX = '100';
    QueueModel.find.mockImplementation(() => mockQuery([]));
    const { app, wsManager, client } = makeApp();
    new ApiManager(client, wsManager);
    new PublicApiManager(client, wsManager);
    const base = await boot(app);

    let ok = 0;
    let limited = 0;
    let limitedBody: any = null;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/public/rbw/api/queues`);
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
