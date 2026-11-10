jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn() },
}));

const UserModel = require('../src/models/User').default;

function chainable(value: any[]) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function service(maps: Array<{ name: string; physical_name?: string; maxplayers: number }>, extra: Record<string, unknown> = {}) {
  return {
    getReservedMaps: jest.fn().mockResolvedValue([]),
    getUnlockedMaps: jest.fn().mockResolvedValue(maps),
    getRecentPickHistory: jest.fn().mockReturnValue([]),
    getRecentlyClaimedNames: jest.fn().mockReturnValue(new Set()),
    claimMap: jest.fn(),
    ...extra,
  };
}

describe('selectMapVoteCandidates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    UserModel.find.mockImplementation(() => chainable([]));
  });

  it('returns three distinct maps ranked by the existing frequency rating', async () => {
    const { selectMapVoteCandidates } = await import('../src/Matchmaking/utils');
    const svc = service(
      ['A', 'B', 'C', 'D', 'E'].map(name => ({ name, maxplayers: 4 })),
      { getRecentPickHistory: jest.fn().mockReturnValue(['A', 'A', 'A']) },
    );

    const candidates = await selectMapVoteCandidates(svc as any, { maxPlayers: 4 }, ['p1']);

    expect(candidates).toEqual(['B', 'C', 'D']);
    expect(new Set(candidates).size).toBe(3);
  });

  it('returns physical arena names used by the warp', async () => {
    const { selectMapVoteCandidates } = await import('../src/Matchmaking/utils');
    const svc = service([
      { name: 'Katsu', physical_name: 'rbw4v4katsu', maxplayers: 4 },
      { name: 'Lighthouse', physical_name: 'rbw4v4lighthouse', maxplayers: 4 },
    ]);

    const candidates = await selectMapVoteCandidates(svc as any, { maxPlayers: 4 });

    expect(candidates).toEqual(['rbw4v4katsu', 'rbw4v4lighthouse']);
  });

  it('skips recently claimed maps', async () => {
    const { selectMapVoteCandidates } = await import('../src/Matchmaking/utils');
    const svc = service(
      ['A', 'B', 'C', 'D'].map(name => ({ name, maxplayers: 4 })),
      { getRecentlyClaimedNames: jest.fn().mockReturnValue(new Set(['A'])) },
    );

    const candidates = await selectMapVoteCandidates(svc as any, { maxPlayers: 4 });

    expect(candidates).toEqual(['B', 'C', 'D']);
  });

  it('falls back to unlocked maps when no map matches the queue size', async () => {
    const { selectMapVoteCandidates } = await import('../src/Matchmaking/utils');
    const svc = service([
      { name: 'Big', maxplayers: 8 },
      { name: 'Small', maxplayers: 2 },
    ]);

    const candidates = await selectMapVoteCandidates(svc as any, { maxPlayers: 4 });

    expect(candidates).toEqual(['Big', 'Small']);
  });

  it('can rank options without claiming them', async () => {
    const { selectRandomMap } = await import('../src/Matchmaking/utils');
    const svc = service([{ name: 'A', maxplayers: 4 }]);

    expect(await selectRandomMap(svc as any, { maxPlayers: 4 }, { claim: false })).toBe('A');
    expect(svc.claimMap).not.toHaveBeenCalled();

    expect(await selectRandomMap(svc as any, { maxPlayers: 4 })).toBe('A');
    expect(svc.claimMap).toHaveBeenCalledWith('A');
  });

  it('throws when the plugin has not sent any maps', async () => {
    const { selectMapVoteCandidates } = await import('../src/Matchmaking/utils');
    const svc = service([]);
    await expect(selectMapVoteCandidates(svc as any, { maxPlayers: 4 })).rejects.toThrow(/No maps available/);
  });
});
