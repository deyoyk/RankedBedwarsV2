import {
  scoreMapsByFrequency,
  pickLeastPlayedMap,
  resolveMapFrequencyOptions,
} from '../src/utils/mapFrequency';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn() },
}));

const UserModel = require('../src/models/User').default;

function chainable(value: any) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
  };
}

describe('scoreMapsByFrequency', () => {
  const opts = { lookbackGames: 5, globalWeight: 1, historySize: 50 };

  it('scores zero heat with no history', () => {
    const scored = scoreMapsByFrequency(['A', 'B'], [[], []], [], opts);
    expect(scored).toEqual([{ name: 'A', heat: 0 }, { name: 'B', heat: 0 }]);
  });

  it('weights recent player maps higher than older ones', () => {
    const scored = scoreMapsByFrequency(['A', 'B', 'C'], [['A', 'B']], [], opts);
    const heat = Object.fromEntries(scored.map(s => [s.name, s.heat]));
    expect(heat.A).toBe(5);
    expect(heat.B).toBe(4);
    expect(heat.C).toBe(0);
  });

  it('sums heat across multiple players', () => {
    const scored = scoreMapsByFrequency(['A', 'B'], [['A'], ['A', 'B']], [], opts);
    const heat = Object.fromEntries(scored.map(s => [s.name, s.heat]));
    expect(heat.A).toBe(5 + 5);
    expect(heat.B).toBe(4);
  });

  it('applies the global weight and history cap', () => {
    const history = ['A', 'A', 'A', 'B'];
    const scored = scoreMapsByFrequency(['A', 'B'], [[], []], history, { ...opts, globalWeight: 2, historySize: 3 });
    const heat = Object.fromEntries(scored.map(s => [s.name, s.heat]));
    expect(heat.A).toBe(2 * 2);
    expect(heat.B).toBe(2 * 1);
  });

  it('trims per-player history to the lookback window', () => {
    const scored = scoreMapsByFrequency(['A', 'B'], [['B', 'B', 'B', 'B', 'B', 'B', 'B']], [], opts);
    const heat = Object.fromEntries(scored.map(s => [s.name, s.heat]));
    expect(heat.B).toBe(5 + 4 + 3 + 2 + 1);
  });
});

describe('pickLeastPlayedMap', () => {
  it('returns null for no candidates', () => {
    expect(pickLeastPlayedMap([])).toBeNull();
  });

  it('picks the single coolest map', () => {
    expect(pickLeastPlayedMap([
      { name: 'A', heat: 3 },
      { name: 'B', heat: 0 },
      { name: 'C', heat: 1 },
    ])).toBe('B');
  });

  it('breaks ties with the provided random source', () => {
    const scored = [{ name: 'A', heat: 0 }, { name: 'B', heat: 0 }];
    expect(pickLeastPlayedMap(scored, () => 0)).toBe('A');
    expect(pickLeastPlayedMap(scored, () => 0.999)).toBe('B');
  });
});

describe('resolveMapFrequencyOptions', () => {
  it('falls back to defaults on garbage', () => {
    expect(resolveMapFrequencyOptions(undefined)).toEqual({ enabled: true, lookbackGames: 5, historySize: 50, globalWeight: 1 });
    expect(resolveMapFrequencyOptions({ lookbackGames: -2, historySize: 0, globalWeight: -1 } as any)).toEqual({ enabled: true, lookbackGames: 5, historySize: 50, globalWeight: 1 });
  });
});

describe('selectRandomMap frequency path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function service(maps: Array<{ name: string; maxplayers: number }>, extra: Record<string, unknown> = {}) {
    return {
      getReservedMaps: jest.fn().mockResolvedValue([]),
      getUnlockedMaps: jest.fn().mockResolvedValue(maps),
      getRecentPickHistory: jest.fn().mockReturnValue([]),
      claimMap: jest.fn(),
      ...extra,
    };
  }

  it('avoids maps the drafted players just played', async () => {
    const { selectRandomMap, clearRecentMapPicks } = await import('../src/Matchmaking/utils');
    UserModel.find.mockImplementation(() => chainable([
      { discordId: 'a', recentGames: [{ map: 'Hot', date: new Date() }, { map: 'Hot', date: new Date(Date.now() - 86400000) }, { map: 'Hot', date: new Date(Date.now() - 2 * 86400000) }] },
      { discordId: 'b', recentGames: [] },
    ]));
    const svc = service([{ name: 'Hot', maxplayers: 2 }, { name: 'Cold', maxplayers: 2 }]);
    const picked = new Set<string>();
    for (let i = 0; i < 20; i++) {
      clearRecentMapPicks();
      picked.add(await selectRandomMap(svc as any, { maxPlayers: 2 }, { playerIds: ['a', 'b'] }));
    }
    expect(picked).toEqual(new Set(['Cold']));
    expect(UserModel.find).toHaveBeenCalled();
  });

  it('falls back to uniform pick without player context', async () => {
    const { selectRandomMap } = await import('../src/Matchmaking/utils');
    const svc = service([{ name: 'A', maxplayers: 2 }, { name: 'B', maxplayers: 2 }]);
    const picked = new Set<string>();
    for (let i = 0; i < 20; i++) {
      picked.add(await selectRandomMap(svc as any, { maxPlayers: 2 }));
    }
    expect(picked.size).toBeGreaterThan(1);
    expect(UserModel.find).not.toHaveBeenCalled();
  });

  it('prefers globally cold maps across games', async () => {
    const { selectRandomMap, clearRecentMapPicks } = await import('../src/Matchmaking/utils');
    UserModel.find.mockImplementation(() => chainable([]));
    const svc = service(
      [{ name: 'Overplayed', maxplayers: 2 }, { name: 'Fresh', maxplayers: 2 }],
      { getRecentPickHistory: jest.fn().mockReturnValue(['Overplayed', 'Overplayed', 'Overplayed']) }
    );
    const picked = new Set<string>();
    for (let i = 0; i < 20; i++) {
      clearRecentMapPicks();
      picked.add(await selectRandomMap(svc as any, { maxPlayers: 2 }, { playerIds: ['x'] }));
    }
    expect(picked).toEqual(new Set(['Fresh']));
  });
});

describe('MapService pick history', () => {
  it('records picks and caps history length', async () => {
    const { MapService } = await import('../src/managers/MapManager');
    const svc = new MapService({ getAllMaps: async () => [], getReservedMaps: async () => [] } as any);
    for (let i = 0; i < 120; i++) svc.claimMap(`Map${i % 3}`);
    const history = svc.getRecentPickHistory(50);
    expect(history).toHaveLength(50);
    expect(history[history.length - 1]).toBe('Map2');
  });
});
