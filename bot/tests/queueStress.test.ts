import { queuePlayers } from '../src/types/queuePlayersMemory';
import { claimPlayers, releasePlayers, isClaimedByOther, clearAllDraftClaims } from '../src/Matchmaking/draftClaims';

const Q1 = '1352587524475713619';
const Q2 = '1352587524475713620';
const Q3 = '1352587524475713621';
const QUEUES = [Q1, Q2, Q3];

function chainable(value: any) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
  };
}

jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]), updateOne: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/services/PresenceService', () => ({
  PresenceService: { evaluate: jest.fn().mockReturnValue('online'), isConnected: jest.fn().mockReturnValue(false) },
}));
jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: {
    getInstance: () => ({
      moveMembers: jest.fn().mockResolvedValue([]),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

const QueueModel = require('../src/models/Queue').default;
const UserModel = require('../src/models/User').default;
const GameModel = require('../src/models/Game').default;
const PartyModel = require('../src/models/Party').default;

const wsManagerMock: any = {
  send: jest.fn(),
  setGlobalHandler: jest.fn(),
  checkPlayerOnline: jest.fn().mockResolvedValue({ online: true }),
};

function queueDoc(channelId: string, maxPlayers = 100) {
  return {
    channelId,
    maxPlayers,
    minElo: 0,
    maxElo: 3000,
    isActive: true,
    isRanked: true,
    isPicking: false,
    queueType: 'random',
    bypassRoles: [],
  };
}

function voiceState(channelId: string | null, userId: string) {
  return {
    channelId,
    member: {
      id: userId,
      user: { username: `user-${userId.slice(-4)}` },
      roles: { cache: new Map() },
      voice: { channelId },
    },
  } as any;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('withPlayerLock self-healing', () => {
  it('recovers after a throwing handler and cleans up the lock map', async () => {
    const { QueueListener } = await import('../src/handlers/QueueListener');
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId)));
    UserModel.findOne.mockImplementation(() => chainable(null));
    const listener = new QueueListener(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsManagerMock,
      {} as any
    );
    const locks = (listener as any).playerLocks as Map<string, Promise<void>>;
    const withLock = (listener as any).withPlayerLock.bind(listener);
    await expect(withLock('u1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withLock('u1', async () => 'recovered')).resolves.toBe('recovered');
    await new Promise(r => setImmediate(r));
    expect(locks.has('u1')).toBe(false);
    try { (listener as any).cleanup?.(); } catch { /* ignore */ }
  });
});

describe('admission fuzz: invariants hold under random interleavings', () => {
  const USERS = Array.from({ length: 8 }, (_, i) => `10000000000000000${i}`);
  let ingame: Set<string>;
  let listener: any;
  let cur: Record<string, string | null>;

  function assertInvariants() {
    const seen = new Map<string, string>();
    for (const q of QUEUES) {
      const list = queuePlayers.get(q) || [];
      expect(new Set(list).size).toBe(list.length);
      for (const id of list) {
        expect(seen.has(id)).toBe(false);
        seen.set(id, q);
        expect(ingame.has(id)).toBe(false);
      }
    }
    const states = (listener as any).queueStates as Map<string, any>;
    for (const [q, state] of states) {
      expect([...state.players].sort()).toEqual([...(queuePlayers.get(q) || [])].sort());
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    clearAllDraftClaims();
    ingame = new Set();
    QueueModel.findOne.mockImplementation((filter: any) =>
      chainable(QUEUES.includes(filter.channelId) ? queueDoc(filter.channelId) : null)
    );
    UserModel.findOne.mockImplementation((filter: any) => chainable({
      discordId: filter.discordId, ign: `ign-${filter.discordId.slice(-4)}`,
      partyId: null, elo: 1000, isBanned: false, isFrozen: false,
    }));
    GameModel.findOne.mockImplementation((filter: any) => {
      const ids = (filter?.$or ?? []).flatMap((o: any) => Object.values(o) as string[]);
      const hit = ids.find((id: string) => ingame.has(id));
      return chainable(hit ? { gameId: 99 } : null);
    });
    GameModel.find.mockImplementation((filter: any) => {
      const ids = (filter?.$or ?? []).flatMap((o: any) => {
        const v = Object.values(o)[0] as any;
        return v?.$in ?? [];
      });
      const busy = ids.filter((id: string) => ingame.has(id));
      return chainable(busy.length > 0 ? [{ team1: busy, team2: [] }] : []);
    });
    const { QueueListener } = await import('../src/handlers/QueueListener');
    listener = new QueueListener(
      { guilds: { cache: { first: () => guildWithLiveVC() } } } as any,
      wsManagerMock,
      {} as any
    );
  });

  function guildWithLiveVC() {
    return {
      channels: {
        cache: new Map(QUEUES.map(q => [q, {
          id: q,
          isVoiceBased: () => true,
          get members() {
            return new Map(
              Object.entries(cur).filter(([, ch]) => ch === q).map(([u]) => [u, {}])
            );
          },
        }])),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  async function sweepAll() {
    for (const q of QUEUES) {
      await (listener as any).validateQueueState(q);
    }
  }

  afterEach(() => {
    try { listener?.cleanup?.(); } catch { /* ignore */ }
  });

  it('200 seeded random ops keep every invariant', async () => {
    const rand = mulberry32(1337);
    cur = {};
    for (const u of USERS) cur[u] = null;
    const NONQ = '9999999999999999999';

    for (let step = 0; step < 200; step++) {
      const batch: Array<Promise<void>> = [];
      const batchSize = 1 + Math.floor(rand() * 4);
      for (let b = 0; b < batchSize; b++) {
        const u = USERS[Math.floor(rand() * USERS.length)];
        const roll = rand();
        const from = cur[u];
        if (roll < 0.45) {
          const to = QUEUES[Math.floor(rand() * QUEUES.length)];
          batch.push(listener.handleVoiceStateUpdate(voiceState(from, u), voiceState(to, u)).then(() => { cur[u] = to; }));
        } else if (roll < 0.65) {
          batch.push(listener.handleVoiceStateUpdate(voiceState(from, u), voiceState(NONQ, u)).then(() => { cur[u] = null; }));
        } else if (roll < 0.8) {
          if (!ingame.has(u)) {
            ingame.add(u);
            batch.push(listener.handleVoiceStateUpdate(voiceState(from, u), voiceState(NONQ, u)).then(() => { cur[u] = null; }));
          }
        } else {
          ingame.delete(u);
          if (from === null && rand() < 0.5) {
            const to = QUEUES[Math.floor(rand() * QUEUES.length)];
            batch.push(listener.handleVoiceStateUpdate(voiceState(null, u), voiceState(to, u)).then(() => { cur[u] = to; }));
          }
        }
        if (rand() < 0.3) await Promise.resolve();
      }
      await Promise.all(batch);
      await sweepAll();
      assertInvariants();
    }
    await new Promise(r => setImmediate(r));
    await sweepAll();
    assertInvariants();
    expect(((listener as any).playerLocks as Map<string, unknown>).size).toBe(0);
  });

  it('switch storm ends with exactly one queue entry', async () => {
    const u = USERS[0];
    let cur: string | null = null;
    for (let i = 0; i < 30; i++) {
      const next = QUEUES[i % QUEUES.length];
      const prev = cur;
      cur = next;
      await listener.handleVoiceStateUpdate(voiceState(prev, u), voiceState(next, u));
    }
    let total = 0;
    for (const q of QUEUES) {
      total += (queuePlayers.get(q) || []).filter(id => id === u).length;
    }
    expect(total).toBe(1);
    expect(queuePlayers.get(cur!)).toContain(u);
  });
});

describe('party admission guards', () => {
  const A = '10000000000000001';
  const B = '10000000000000002';

  function vcGuild(memberIds: string[], channelId: string) {
    const members = new Map(memberIds.map(id => [id, { id }]));
    return {
      channels: {
        cache: new Map([[channelId, { id: channelId, isVoiceBased: () => true, members }]]),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  it('party joins once per member and leaves as a unit', async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId)));
    const users: Record<string, any> = {
      [A]: { discordId: A, ign: 'A', partyId: 'p1', elo: 1000, isBanned: false, isFrozen: false },
      [B]: { discordId: B, ign: 'B', partyId: 'p1', elo: 1000, isBanned: false, isFrozen: false },
    };
    UserModel.findOne.mockImplementation((filter: any) => chainable(users[filter.discordId] ?? null));
    UserModel.find.mockImplementation(() => chainable([users[A], users[B]]));
    PartyModel.findOne.mockImplementation(() => chainable({ partyId: 'p1', members: [A, B] }));
    PartyModel.find.mockImplementation(() => chainable([{ partyId: 'p1', members: [A, B] }]));
    GameModel.findOne.mockImplementation(() => chainable(null));
    const { QueueListener } = await import('../src/handlers/QueueListener');
    const guild: any = vcGuild([A, B], Q1);
    guild.members = { cache: new Map(), fetch: jest.fn() };
    const listener = new QueueListener(
      { guilds: { cache: { first: () => guild } } } as any,
      wsManagerMock,
      {} as any
    );
    try {
      await listener.handleVoiceStateUpdate(voiceState(null, A), { ...voiceState(Q1, A), member: { id: A, roles: { cache: new Map() }, voice: {} } });
      await listener.handleVoiceStateUpdate(voiceState(null, B), { ...voiceState(Q1, B), member: { id: B, roles: { cache: new Map() }, voice: {} } });
      const listed = queuePlayers.get(Q1) || [];
      expect(listed.filter(id => id === A)).toHaveLength(1);
      expect(listed.filter(id => id === B)).toHaveLength(1);
      await listener.handleVoiceStateUpdate(
        { ...voiceState(Q1, A), member: { id: A, roles: { cache: new Map() }, voice: {} } } as any,
        voiceState(null, A)
      );
      expect(queuePlayers.get(Q1) || []).toHaveLength(0);
    } finally {
      try { (listener as any).cleanup?.(); } catch { /* ignore */ }
    }
  });
});

describe('picking final revalidation', () => {
  const eligibleUsers = (overrides: Record<string, any> = {}) => {
    const base: Record<string, any> = {
      a: { discordId: 'a', isBanned: false, isFrozen: false, elo: 1000 },
      b: { discordId: 'b', isBanned: false, isFrozen: false, elo: 1000 },
      c: { discordId: 'c', isBanned: false, isFrozen: false, elo: 1000 },
      d: { discordId: 'd', isBanned: false, isFrozen: false, elo: 1000 },
    };
    for (const [k, v] of Object.entries(overrides)) base[k] = { ...base[k], ...v };
    return Object.values(base);
  };
  it.each([
    ['clean teams pass', { team1: ['a', 'b'], team2: ['c', 'd'] }, ['a', 'b', 'c', 'd'], null, {}, true],
    ['duplicates fail', { team1: ['a', 'a'], team2: ['c', 'd'] }, ['a', 'c', 'd'], null, {}, false],
    ['leaver fails', { team1: ['a', 'b'], team2: ['c', 'd'] }, ['a', 'b', 'c'], null, {}, false],
    ['in-game player fails', { team1: ['a', 'b'], team2: ['c', 'd'] }, ['a', 'b', 'c', 'd'], { team1: ['x'], team2: ['a'] }, {}, false],
    ['banned player fails', { team1: ['a', 'b'], team2: ['c', 'd'] }, ['a', 'b', 'c', 'd'], null, { b: { isBanned: true } }, false],
    ['out-of-range elo fails', { team1: ['a', 'b'], team2: ['c', 'd'] }, ['a', 'b', 'c', 'd'], null, { d: { elo: 99999 } }, false],
  ])('%s', async (_label, teams: any, present: string[], clash: any, userOverrides: any, expected: boolean) => {
    jest.clearAllMocks();
    const { PickingQueueManager } = await import('../src/Matchmaking/PickingQueueManager');
    GameModel.findOne.mockImplementation(() => ({
      select: () => ({ lean: async () => clash }),
      lean: async () => clash,
    }));
    UserModel.find.mockImplementation(() => chainable(eligibleUsers(userOverrides)));
    const mgr = new PickingQueueManager({} as any, {} as any, wsManagerMock as any);
    const channel = { members: { keys: () => present[Symbol.iterator]() } } as any;
    const result = await (mgr as any).revalidateFinalTeams(teams, channel, { minElo: 0, maxElo: 3000 });
    expect(result !== null).toBe(expected);
  });

  it('drops players who went offline in Minecraft', async () => {
    jest.clearAllMocks();
    const { PickingQueueManager } = await import('../src/Matchmaking/PickingQueueManager');
    const { PresenceService } = require('../src/services/PresenceService');
    PresenceService.evaluate.mockImplementation((ign: string) => (ign === 'C' ? 'offline' : 'online'));
    try {
      GameModel.findOne.mockImplementation(() => ({
        select: () => ({ lean: async () => null }),
        lean: async () => null,
      }));
      UserModel.find.mockImplementation(() => chainable(
        ['a', 'b', 'c', 'd'].map(id => ({ discordId: id, ign: id.toUpperCase(), isBanned: false, isFrozen: false, elo: 1000 }))
      ));
      const mgr = new PickingQueueManager({} as any, {} as any, wsManagerMock as any);
      const channel = { members: { keys: () => ['a', 'b', 'c', 'd'][Symbol.iterator]() } } as any;
      const result = await (mgr as any).revalidateFinalTeams(
        { team1: ['a', 'b'], team2: ['c', 'd'] }, channel, { minElo: 0, maxElo: 3000 }
      );
      expect(result).toBeNull();
    } finally {
      PresenceService.evaluate.mockReturnValue('online');
    }
  });

  it('lets players with unknown presence through to the online check', async () => {
    jest.clearAllMocks();
    const { PickingQueueManager } = await import('../src/Matchmaking/PickingQueueManager');
    const { PresenceService } = require('../src/services/PresenceService');
    PresenceService.evaluate.mockReturnValue('unknown');
    try {
      GameModel.findOne.mockImplementation(() => ({
        select: () => ({ lean: async () => null }),
        lean: async () => null,
      }));
      UserModel.find.mockImplementation(() => chainable(
        ['a', 'b', 'c', 'd'].map(id => ({ discordId: id, ign: id.toUpperCase(), isBanned: false, isFrozen: false, elo: 1000 }))
      ));
      const mgr = new PickingQueueManager({} as any, {} as any, wsManagerMock as any);
      const channel = { members: { keys: () => ['a', 'b', 'c', 'd'][Symbol.iterator]() } } as any;
      const result = await (mgr as any).revalidateFinalTeams(
        { team1: ['a', 'b'], team2: ['c', 'd'] }, channel, { minElo: 0, maxElo: 3000 }
      );
      expect(result).not.toBeNull();
    } finally {
      PresenceService.evaluate.mockReturnValue('online');
    }
  });
});

describe('random draft revalidation', () => {
  it('drops leavers and in-game players, fails closed on DB error', async () => {
    jest.clearAllMocks();
    const { RandomQueueManager } = await import('../src/Matchmaking/RandomQueueManager');
    const guild: any = {
      channels: {
        cache: new Map([[Q1, { id: Q1, isVoiceBased: () => true, members: new Map([['a', {}], ['b', {}]]) }]]),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
    };
    const mgr = new RandomQueueManager({ guilds: { cache: { first: () => guild } } } as any, {} as any, wsManagerMock as any);
    UserModel.find.mockImplementation(() => chainable([
      { discordId: 'a', isBanned: false, isFrozen: false, elo: 1000 },
      { discordId: 'b', isBanned: false, isFrozen: false, elo: 1000 },
    ]));
    GameModel.findOne.mockImplementation(() => ({
      select: () => ({ lean: async () => ({ team1: ['b'], team2: ['x'] }) }),
      lean: async () => null,
    }));
    const queueData = { channelId: Q1, maxPlayers: 8, minElo: 0, maxElo: 3000, isActive: true };
    expect(await (mgr as any).revalidateDraftedPlayers(['a', 'b', 'c'], queueData)).toEqual(['a']);
    UserModel.find.mockImplementation(() => chainable([
      { discordId: 'a', isBanned: true, isFrozen: false, elo: 1000 },
      { discordId: 'b', isBanned: false, isFrozen: false, elo: 1000 },
    ]));
    GameModel.findOne.mockImplementation(() => ({
      select: () => ({ lean: async () => null }),
      lean: async () => null,
    }));
    expect(await (mgr as any).revalidateDraftedPlayers(['a', 'b'], queueData)).toEqual(['b']);
    GameModel.findOne.mockImplementation(() => { throw new Error('db down'); });
    expect(await (mgr as any).revalidateDraftedPlayers(['a', 'b'], queueData)).toEqual([]);
  });

  it('drops players who went offline in Minecraft', async () => {
    jest.clearAllMocks();
    const { RandomQueueManager } = await import('../src/Matchmaking/RandomQueueManager');
    const { PresenceService } = require('../src/services/PresenceService');
    PresenceService.evaluate.mockImplementation((ign: string) => (ign === 'A' ? 'offline' : 'online'));
    try {
      const guild: any = {
        channels: {
          cache: new Map([[Q1, { id: Q1, isVoiceBased: () => true, members: new Map([['a', {}], ['b', {}]]) }]]),
          fetch: jest.fn().mockResolvedValue(undefined),
        },
      };
      const mgr = new RandomQueueManager({ guilds: { cache: { first: () => guild } } } as any, {} as any, wsManagerMock as any);
      UserModel.find.mockImplementation(() => chainable([
        { discordId: 'a', ign: 'A', isBanned: false, isFrozen: false, elo: 1000 },
        { discordId: 'b', ign: 'B', isBanned: false, isFrozen: false, elo: 1000 },
      ]));
      GameModel.findOne.mockImplementation(() => ({
        select: () => ({ lean: async () => null }),
        lean: async () => null,
      }));
      const queueData = { channelId: Q1, maxPlayers: 8, minElo: 0, maxElo: 3000, isActive: true };
      expect(await (mgr as any).revalidateDraftedPlayers(['a', 'b'], queueData)).toEqual(['b']);
    } finally {
      PresenceService.evaluate.mockReturnValue('online');
    }
  });
});

describe('verified voice moves', () => {
  const VC = '1390000000000000001';

  function voiceGuild(members: string[]) {
    return {
      channels: {
        cache: new Map([[VC, {
          id: VC,
          isVoiceBased: () => true,
          members: new Map(members.map(id => [id, {}])),
        }]]),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

  it('retries failed moves and reports who is still missing', async () => {
    jest.clearAllMocks();
    const { GameManager } = await import('../src/Matchmaking/GameManager');
    const gm = new GameManager({} as any, wsManagerMock as any);
    const moveMock = jest.fn()
      .mockResolvedValueOnce([
        { status: 'fulfilled', value: undefined },
        { status: 'rejected', reason: new Error('rate limited') },
      ])
      .mockResolvedValue([
        { status: 'fulfilled', value: undefined },
        { status: 'fulfilled', value: undefined },
      ]);
    (gm as any).workersManager.moveMembers = moveMock;
    const missing = await (gm as any).movePlayersToVoice(
      { channels: voiceGuild(['a', 'b']).channels } as any, ['a', 'b'], VC
    );
    expect(missing).toEqual([]);
    expect(moveMock).toHaveBeenCalledTimes(2);
  }, 20000);

  it('returns players that never arrive', async () => {
    jest.clearAllMocks();
    const { GameManager } = await import('../src/Matchmaking/GameManager');
    const gm = new GameManager({} as any, wsManagerMock as any);
    const moveMock = jest.fn().mockResolvedValue([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]);
    (gm as any).workersManager.moveMembers = moveMock;
    const missing = await (gm as any).movePlayersToVoice(
      { channels: voiceGuild(['a']).channels } as any, ['a', 'b'], VC
    );
    expect(missing).toEqual(['b']);
    expect(moveMock).toHaveBeenCalledTimes(1);
  }, 20000);
});
