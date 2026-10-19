import { ApiManager } from '../src/api/ApiManager';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn() }
}));
jest.mock('../src/managers/SeasonManager', () => ({
  SeasonManager: { getCurrentSeason: jest.fn().mockResolvedValue(null) }
}));

const express = require('express');

function makeManager(): ApiManager {
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
  return new ApiManager(client, wsManager);
}

describe('ApiManager response cache', () => {
  it('returns cached values within TTL without refetching', async () => {
    const manager = makeManager() as any;
    const fetcher = jest.fn().mockResolvedValue('v1');
    await expect(manager.getCached('k', 60000, fetcher)).resolves.toBe('v1');
    await expect(manager.getCached('k', 60000, fetcher)).resolves.toBe('v1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refetches after TTL expiry', async () => {
    const manager = makeManager() as any;
    const fetcher = jest.fn().mockResolvedValue('v');
    await manager.getCached('k', 10, fetcher);
    await new Promise(r => setTimeout(r, 25));
    await manager.getCached('k', 10, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('enforces a hard cap with fresh TTLs', async () => {
    const manager = makeManager() as any;
    for (let i = 0; i < 250; i++) {
      await manager.getCached(`key-${i}`, 60000, async () => i);
    }
    expect(manager.cache.size).toBeLessThanOrEqual(100);
    expect(manager.cache.has('key-249')).toBe(true);
  });
});
