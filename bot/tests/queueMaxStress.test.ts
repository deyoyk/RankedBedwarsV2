import { queuePlayers } from '../src/types/queuePlayersMemory';

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
  default: { findOne: jest.fn(), find: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) },
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
jest.mock('../src/managers/MapManager', () => ({
  MapService: jest.fn().mockImplementation(() => ({
    getReservedMaps: jest.fn().mockResolvedValue([{ name: 'M1', maxplayers: 2 }]),
    getUnlockedMaps: jest.fn().mockResolvedValue([{ name: 'M1', maxplayers: 2 }]),
  })),
}));

const QueueModel = require('../src/models/Queue').default;
const UserModel = require('../src/models/User').default;
const GameModel = require('../src/models/Game').default;

const wsMock: any = {
  send: jest.fn(),
  setGlobalHandler: jest.fn(),
  checkPlayerOnline: jest.fn().mockResolvedValue({ online: true }),
};

function queueDoc(channelId: string, maxPlayers = 2) {
  return {
    channelId, maxPlayers, minElo: 0, maxElo: 3000,
    isActive: true, isRanked: true, isPicking: false, queueType: 'random', bypassRoles: [],
  };
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

describe('cross-queue concurrent draft (e2e double-queue proof)', () => {
  it('one stale player in two full queues is drafted exactly once', async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    const { clearAllDraftClaims } = await import('../src/Matchmaking/draftClaims');
    clearAllDraftClaims();

    const liveGames: Array<{ team1: string[]; team2: string[]; state: string }> = [];
    const createdTeams: string[][] = [];
    let nextId = 500;
    const gameManagerMock: any = {
      getActiveGameCount: () => 0,
      getNextGameId: async () => nextId++,
      createGame: jest.fn(async (_id: number, _q: any, t1: string[], t2: string[]) => {
        liveGames.push({ team1: [...t1], team2: [...t2], state: 'active' });
        createdTeams.push([...t1, ...t2]);
        return { gameId: 1 };
      }),
      updateGameMap: jest.fn(async () => {}),
      initiateGameWarp: jest.fn(async () => {}),
    };

    const users: Record<string, any> = {
      a: { discordId: 'a', ign: 'A', partyId: null, elo: 1000 },
      b: { discordId: 'b', ign: 'B', partyId: null, elo: 1000 },
      c: { discordId: 'c', ign: 'C', partyId: null, elo: 1000 },
    };
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId)));
    UserModel.find.mockImplementation((filter: any) => chainable(
      Object.values(users).filter((u: any) => filter.discordId.$in.includes(u.discordId))
    ));
    const gameLookup = (ids: string[]) => liveGames.filter(g =>
      g.team1.concat(g.team2).some(id => ids.includes(id))
    );
    GameModel.find.mockImplementation((filter: any) => {
      const ids = (filter?.$or ?? []).flatMap((o: any) => ((Object.values(o)[0] as any)?.$in ?? []));
      return chainable(gameLookup(ids));
    });
    GameModel.findOne.mockImplementation((filter: any) => {
      if (filter?.gameId) return chainable(null);
      const ids = (filter?.$or ?? []).flatMap((o: any) => {
        const v = Object.values(o)[0] as any;
        return typeof v === 'string' ? [v] : (v?.$in ?? []);
      });
      const hit = gameLookup(ids)[0];
      return chainable(hit ? { gameId: 1 } : null);
    });

    const { CentralizedMatchmaker } = await import('../src/Matchmaking/CentralizedMatchmaker');
    const mm = new CentralizedMatchmaker(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsMock,
      gameManagerMock
    );
    try {
      queuePlayers.set(Q1, ['a', 'b']);
      queuePlayers.set(Q2, ['a', 'c']);
      const [r1, r2] = await Promise.all([mm.processQueue(Q1), mm.processQueue(Q2)]);
      const totalGames = (r1.gamesCreated ?? 0) + (r2.gamesCreated ?? 0);
      expect(totalGames).toBeGreaterThanOrEqual(1);
      const flat = createdTeams.flat();
      expect(flat.filter(id => id === 'a')).toHaveLength(1);
      expect(new Set(flat).size).toBe(flat.length);
    } finally {
      (mm as any).cleanup?.();
    }
  });
});

describe('random draft under mid-draft churn', () => {
  it('drops a leaver instead of drafting them, no crash, no game', async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    const { clearAllDraftClaims } = await import('../src/Matchmaking/draftClaims');
    clearAllDraftClaims();

    let presentCalls = 0;
    const presentSets = [['a', 'b'], ['b'], ['b']];
    const guild: any = {
      channels: {
        cache: new Map([[Q1, {
          id: Q1,
          isVoiceBased: () => true,
          members: { keys: () => presentSets[Math.min(presentCalls++, presentSets.length - 1)][Symbol.iterator]() },
        }]]),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
    };
    const users: Record<string, any> = {
      a: { discordId: 'a', ign: 'A', partyId: null, elo: 1000 },
      b: { discordId: 'b', ign: 'B', partyId: null, elo: 1000 },
    };
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId)));
    UserModel.find.mockImplementation((filter: any) => chainable(
      Object.values(users).filter((u: any) => filter.discordId.$in.includes(u.discordId))
    ));
    GameModel.find.mockImplementation(() => chainable([]));
    GameModel.findOne.mockImplementation(() => chainable(null));
    const gameManagerMock: any = {
      getActiveGameCount: () => 0,
      getNextGameId: async () => 1,
      createGame: jest.fn(async () => ({ gameId: 1 })),
      updateGameMap: jest.fn(async () => {}),
      initiateGameWarp: jest.fn(async () => {}),
    };
    const { CentralizedMatchmaker } = await import('../src/Matchmaking/CentralizedMatchmaker');
    const mm = new CentralizedMatchmaker(
      { guilds: { cache: { first: () => guild } } } as any,
      wsMock,
      gameManagerMock
    );
    try {
      queuePlayers.set(Q1, ['a', 'b']);
      const result = await mm.processQueue(Q1);
      expect(result.gamesCreated).toBe(0);
      expect(gameManagerMock.createGame).not.toHaveBeenCalled();
    } finally {
      (mm as any).cleanup?.();
    }
  });
});

describe('websocket queuefromingame flood', () => {
  it('15 concurrent requests collapse to one move and one entry', async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    const UID = '123456789012345678';
    UserModel.findOne.mockImplementation(() => ({
      collation: () => ({ select: () => ({ lean: async () => ({ discordId: UID, elo: 1000, ign: 'Steve' }) }) }),
    }));
    QueueModel.find.mockImplementation(() => chainable([{ channelId: Q1 }]));
    GameModel.findOne.mockImplementation(() => ({ select: () => ({ lean: async () => null }), lean: async () => null }));
    const setChannel = jest.fn().mockResolvedValue(undefined);
    const guild: any = {
      id: 'guild1',
      members: {
        cache: new Map([[UID, { id: UID, voice: { channel: { id: 'vc1' }, setChannel } }]]),
        fetch: jest.fn(),
      },
      channels: {
        cache: new Map([[Q1, { id: Q1, isVoiceBased: () => true, name: 'q1' }]]),
        fetch: jest.fn(),
      },
    };
    const { WebSocketManager } = await import('../src/websocket/WebSocketManager');
    const ws = new WebSocketManager(0, { guilds: { cache: { first: () => guild } } } as any);
    (ws as any).send = jest.fn();
    const servers: Array<{ close: (cb?: () => void) => void }> = [];
    if ((ws as any).server?.close) servers.push((ws as any).server);
    try {
      await Promise.all(Array.from({ length: 15 }, (_, i) =>
        (ws as any).handleQueueFromInGame({ ign: 'Steve', uuid: `u${i}` })
      ));
      expect(setChannel).toHaveBeenCalledTimes(1);
      expect(queuePlayers.get(Q1)?.filter(id => id === UID)).toHaveLength(1);
      const sent = (ws as any).send.mock.calls.map((c: any) => c[0]);
      expect(sent.filter((p: any) => p.type === 'queuefromingame_success')).toHaveLength(15);
      expect(sent.some((p: any) => p.type === 'queuefromingame_fail')).toBe(false);
    } finally {
      for (const s of servers) { try { s.close(); } catch { /* ignore */ } }
    }
  });
});

describe('admission fuzz across seeds', () => {
  const USERS = Array.from({ length: 8 }, (_, i) => `1000000000000000${i}`);
  let ingame: Set<string>;
  let listener: any;
  let cur: Record<string, string | null>;

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

  function guildWithLiveVC() {
    return {
      channels: {
        cache: new Map(QUEUES.map(q => [q, {
          id: q,
          isVoiceBased: () => true,
          get members() {
            return new Map(Object.entries(cur).filter(([, ch]) => ch === q).map(([u]) => [u, {}]));
          },
        }])),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
    };
  }

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

  async function runSeed(seed: number, steps: number) {
    jest.clearAllMocks();
    queuePlayers.clear();
    const { clearAllDraftClaims } = await import('../src/Matchmaking/draftClaims');
    clearAllDraftClaims();
    ingame = new Set();
    cur = {};
    for (const u of USERS) cur[u] = null;
    QueueModel.findOne.mockImplementation((filter: any) =>
      chainable(QUEUES.includes(filter.channelId) ? { ...queueDoc(filter.channelId, 100), maxPlayers: 100 } : null)
    );
    QueueModel.find.mockResolvedValue([]);
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
      wsMock,
      {} as any
    );
    const NONQ = '9999999999999999999';
    const rand = mulberry32(seed);
    try {
      for (let step = 0; step < steps; step++) {
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
        for (const q of QUEUES) await (listener as any).validateQueueState(q);
        assertInvariants();
      }
      await new Promise(r => setImmediate(r));
      for (const q of QUEUES) await (listener as any).validateQueueState(q);
      assertInvariants();
      expect(((listener as any).playerLocks as Map<string, unknown>).size).toBe(0);
      const snapshot = JSON.stringify(QUEUES.map(q => queuePlayers.get(q) || []));
      return snapshot;
    } finally {
      try { (listener as any).matchmaker?.cleanup?.(); } catch { /* ignore */ }
    }
  }

  it.each([7, 4242, 99991])('seed %i: 250 adversarial steps hold every invariant', async (seed) => {
    await runSeed(seed, 250);
  });

  it('same seed is deterministic', async () => {
    const first = await runSeed(777, 120);
    const second = await runSeed(777, 120);
    expect(first).toBe(second);
  });
});
