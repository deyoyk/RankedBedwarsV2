import { calculateTeamAverageElo, selectRandomMap } from '../src/Matchmaking/utils';

jest.mock('../src/models/User', () => ({
  find: jest.fn().mockReturnValue({
    select: jest.fn().mockResolvedValue([
      { elo: 1000 },
      { elo: 1200 },
      { elo: 1400 }
    ])
  })
}));

describe('calculateTeamAverageElo', () => {
  it('returns the rounded average', async () => {
    const avg = await calculateTeamAverageElo(['a', 'b', 'c']);
    expect(avg).toBe(1200);
  });

  it('returns 0 for an empty team', async () => {
    const avg = await calculateTeamAverageElo([]);
    expect(avg).toBe(0);
  });

  it('handles missing elo values as 0', async () => {
    const { find } = require('../src/models/User');
    find.mockReturnValue({
      select: jest.fn().mockResolvedValue([
        { elo: undefined },
        { elo: 500 }
      ])
    });
    const avg = await calculateTeamAverageElo(['a', 'b']);
    expect(avg).toBe(250);
  });
});

describe('selectRandomMap', () => {
  const makeService = (reserved: any[], unlocked: any[]) => ({
    getReservedMaps: jest.fn().mockResolvedValue(reserved),
    getUnlockedMaps: jest.fn().mockResolvedValue(unlocked)
  });

  it('prefers reserved maps matching maxPlayers', async () => {
    const service = makeService(
      [{ name: 'MapA', maxplayers: 8 }, { name: 'MapB', maxplayers: 4 }],
      []
    );
    const map = await selectRandomMap(service as any, { maxPlayers: 8 });
    expect(map).toBe('MapA');
  });

  it('falls back to unlocked maps when no reserved match', async () => {
    const service = makeService(
      [{ name: 'MapA', maxplayers: 2 }],
      [{ name: 'MapB', maxplayers: 4 }]
    );
    const map = await selectRandomMap(service as any, { maxPlayers: 4 });
    expect(map).toBe('MapB');
  });

  it('falls back to any unlocked map when none match the player count', async () => {
    const service = makeService([], [{ name: 'MapB', maxplayers: 4 }]);
    const map = await selectRandomMap(service as any, { maxPlayers: 8 });
    expect(map).toBe('MapB');
  });

  it('falls back to Aquarius when no maps exist at all', async () => {
    const service = makeService([], []);
    const map = await selectRandomMap(service as any, { maxPlayers: 8 });
    expect(map).toBe('Aquarius');
  });

  it('falls back to Aquarius on error', async () => {
    const service = {
      getReservedMaps: jest.fn().mockRejectedValue(new Error('boom'))
    };
    const map = await selectRandomMap(service as any, { maxPlayers: 4 });
    expect(map).toBe('Aquarius');
  });
});
