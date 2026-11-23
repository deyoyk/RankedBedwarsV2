import { addqueue } from '../src/commands/queue/addqueue';
import { selectMapVoteCandidates, selectRandomMap } from '../src/Matchmaking/utils';

const mockCreated: any[] = [];

jest.mock('../src/models/Queue', () => {
  const Queue: any = jest.fn().mockImplementation((doc: any) => {
    mockCreated.push(doc);
    return { ...doc, save: jest.fn().mockResolvedValue(undefined) };
  });
  Queue.findOne = jest.fn().mockResolvedValue(null);
  return { __esModule: true, default: Queue };
});

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn().mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) }) }
}));

function interaction(options: Record<string, any>) {
  return {
    user: { id: '999000000000000001' },
    options: {
      getString: (name: string) => options[name] ?? null,
      getInteger: (name: string) => options[name] ?? null,
      getBoolean: (name: string) => options[name] ?? null,
    },
    reply: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    followUp: jest.fn().mockResolvedValue({}),
    deferred: false,
    replied: false,
  } as any;
}

const base = { channel_id: '123456789012345678', min_elo: 0, max_elo: 3000, is_ranked: true, is_picking: false };

function service(maps: Array<{ name: string; maxplayers: number }>) {
  return {
    getReservedMaps: jest.fn().mockResolvedValue([]),
    getUnlockedMaps: jest.fn().mockResolvedValue(maps),
  };
}

beforeEach(() => {
  mockCreated.length = 0;
});

describe('/addqueue map option', () => {
  test('stores the map size of a 4v4 queue', async () => {
    await addqueue(interaction({ ...base, max_players: 8, map: 4 }));
    expect(mockCreated).toHaveLength(1);
    expect(mockCreated[0].mapTeamSize).toBe(4);
  });

  test('lets a 3v3 queue use 4v4 maps', async () => {
    await addqueue(interaction({ ...base, max_players: 6, map: 4 }));
    expect(mockCreated[0].mapTeamSize).toBe(4);
  });

  test('refuses maps too small for the teams', async () => {
    const i = interaction({ ...base, max_players: 8, map: 2 });
    await addqueue(i);
    expect(mockCreated).toHaveLength(0);
    expect(JSON.stringify(i.reply.mock.calls)).toContain('2v2 maps');
  });

  test('a queue without the option keeps matching maps by player count', async () => {
    await addqueue(interaction({ ...base, max_players: 8 }));
    expect(mockCreated[0].mapTeamSize).toBeUndefined();
  });
});

describe('map picking for a queue with a map size', () => {
  const maps = [
    { name: 'Doubles1', maxplayers: 4 },
    { name: 'Trios1', maxplayers: 6 },
    { name: 'Quads1', maxplayers: 8 },
    { name: 'Quads2', maxplayers: 8 },
  ];

  test('only picks maps of that size, even when another size matches the player count', async () => {
    for (let i = 0; i < 20; i++) {
      expect(['Quads1', 'Quads2']).toContain(await selectRandomMap(service(maps) as any, { maxPlayers: 6, mapTeamSize: 4 }, { claim: false }));
    }
  });

  test('never falls back to another size', async () => {
    await expect(selectRandomMap(service([{ name: 'Doubles1', maxplayers: 4 }]) as any, { maxPlayers: 8, mapTeamSize: 4 }))
      .rejects.toThrow(/No 4v4 maps/);
  });

  test('the map vote only offers maps of that size', async () => {
    const candidates = await selectMapVoteCandidates(service(maps) as any, { maxPlayers: 8, mapTeamSize: 4 });
    expect([...candidates].sort()).toEqual(['Quads1', 'Quads2']);
  });
});
