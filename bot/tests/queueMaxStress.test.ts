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
const { clearPlayerDirectoryCache } = require('../src/utils/playerDirectory');

const wsMock: any = {
  send: jest.fn(),
  setGlobalHandler: jest.fn(),
  checkPlayerOnline: jest.fn().mockResolvedValue({ online: true }),
  checkPlayers: jest.fn().mockResolvedValue(new Map()),
  checkBedwarsPlayers: jest.fn().mockResolvedValue(new Map()),
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
    QueueModel.find.mockImplementation(() => chainable([
      { channelId: Q1, minElo: 0, maxElo: 9999, maxPlayers: 8, isRanked: false },
    ]));
    GameModel.findOne.mockImplementation(() => ({ select: () => ({ lean: async () => null }), lean: async () => null }));
    const setChannel = jest.fn().mockResolvedValue(undefined);
    const guild: any = {
      id: 'guild1',
      members: {
        cache: new Map([[UID, {
          id: UID,
          voice: { channel: { id: 'vc1' }, setChannel },
          roles: { cache: { has: () => false } },
        }]]),
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
      try { (ws as any).shutdown?.(); } catch {  }
      for (const s of servers) { try { s.close(); } catch {  } }
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
    clearPlayerDirectoryCache();
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
    UserModel.find.mockImplementation((filter: any) => {
      const ids = filter?.discordId?.$in ?? [];
      return chainable(ids.map((id: string) => ({ discordId: id, ign: `ign-${id.slice(-4)}` })));
    });
    wsMock.checkPlayers.mockImplementation(async (igns: string[]) => {
      const statuses = new Map<string, { online: boolean; inGame: boolean }>();
      for (const ign of igns) {
        const suffix = String(ign).toLowerCase().replace(/^ign-/, '');
        const id = USERS.find(user => user.slice(-4) === suffix);
        statuses.set(String(ign).toLowerCase(), { online: true, inGame: Boolean(id && ingame.has(id)) });
      }
      return statuses;
    });
    wsMock.checkBedwarsPlayers.mockImplementation(async (igns: string[]) => {
      const statuses = new Map<string, boolean>();
      for (const ign of igns) {
        const suffix = String(ign).toLowerCase().replace(/^ign-/, '');
        const id = USERS.find(user => user.slice(-4) === suffix);
        statuses.set(String(ign).toLowerCase(), Boolean(id && ingame.has(id)));
      }
      return statuses;
    });
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
      try { (listener as any).matchmaker?.cleanup?.(); } catch {  }
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

describe('perf and resource-leak guards', () => {
  it('sweep over a full house finishes fast and leaves no residue', async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    const { clearAllDraftClaims, isClaimedByOther } = await import('../src/Matchmaking/draftClaims');
    clearAllDraftClaims();
    const ids = Array.from({ length: 500 }, (_, i) => `900000000000000${String(i).padStart(2, '0')}`);
    const docs = ids.map(id => ({ discordId: id, ign: `U${id.slice(-4)}`, partyId: null, elo: 1000, isBanned: false, isFrozen: false }));
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId, 600)));
    UserModel.findOne.mockImplementation((filter: any) => chainable(docs.find(d => d.discordId === filter.discordId) ?? null));
    UserModel.find.mockImplementation((filter: any) => chainable(docs.filter(d => filter.discordId.$in.includes(d.discordId))));
    GameModel.findOne.mockImplementation(() => chainable(null));
    GameModel.find.mockImplementation(() => chainable([]));
    const vcMembers = new Map(ids.map(id => [id, {}]));
    const guild: any = {
      channels: {
        cache: new Map(QUEUES.map(q => [q, { id: q, isVoiceBased: () => true, members: q === Q1 ? vcMembers : new Map() }])),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
      members: { cache: new Map(), fetch: jest.fn() },
    };
    const { QueueListener } = await import('../src/handlers/QueueListener');
    const listener = new QueueListener(
      { guilds: { cache: { first: () => guild } } } as any,
      wsMock,
      { getActiveGameCount: () => 100 } as any
    );
    try {
      (listener as any).queueStates.set(Q1, {
        players: [...ids], parties: new Map(), lastUpdate: 0, processing: false,
      });
      queuePlayers.set(Q1, [...ids]);
      const start = Date.now();
      await (listener as any).validateQueueState(Q1);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(3000);
      expect(queuePlayers.get(Q1)).toHaveLength(500);
      expect(isClaimedByOther(ids[0], Q2)).toBe(false);
      expect(((listener as any).playerLocks as Map<string, unknown>).size).toBe(0);
    } finally {
      try { (listener as any).matchmaker?.cleanup?.(); } catch {  }
    }
  });

  it('draft claims drain after processing', async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    const { clearAllDraftClaims, isClaimedByOther } = await import('../src/Matchmaking/draftClaims');
    clearAllDraftClaims();
    const users = ['x', 'y'].map(id => ({ discordId: id, ign: id.toUpperCase(), partyId: null, elo: 1000, isBanned: false, isFrozen: false }));
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId, 2)));
    UserModel.find.mockImplementation(() => chainable(users));
    UserModel.findOne.mockImplementation((filter: any) => chainable(users.find(u => u.discordId === filter.discordId) ?? null));
    GameModel.find.mockImplementation(() => chainable([]));
    GameModel.findOne.mockImplementation(() => chainable(null));
    const gameManagerMock: any = {
      getActiveGameCount: () => 0,
      getNextGameId: async () => 1,
      createGame: jest.fn(async (id: number) => ({ gameId: id })),
      updateGameMap: jest.fn(async () => {}),
      initiateGameWarp: jest.fn(async () => {}),
    };
    const { CentralizedMatchmaker } = await import('../src/Matchmaking/CentralizedMatchmaker');
    const mm = new CentralizedMatchmaker(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsMock,
      gameManagerMock
    );
    try {
      queuePlayers.set(Q1, ['x', 'y']);
      const r = await mm.processQueue(Q1);
      expect(r.gamesCreated).toBe(1);
      for (const id of ['x', 'y']) {
        for (const q of [Q1, Q2, 'other']) {
          expect(isClaimedByOther(id, q)).toBe(false);
        }
      }
    } finally {
      (mm as any)?.cleanup?.();
    }
  });
});

describe('full lifecycle live simulation', () => {
  const USERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => ({
    discordId: id, ign: id.toUpperCase(), partyId: null, elo: 1000,
    isBanned: false, isFrozen: false,
  }));
  const byId: Record<string, any> = Object.fromEntries(USERS.map(u => [u.discordId, u]));
  let liveGames: Array<{ gameId: number; team1: string[]; team2: string[]; state: string }>;
  let nextId: number;
  let mm: any;
  let listener: any;
  let createdTeams: string[][];

  function voiceState(channelId: string | null, userId: string) {
    return {
      channelId,
      member: {
        id: userId,
        user: { username: userId },
        roles: { cache: new Map() },
        voice: { channelId },
      },
    } as any;
  }

  function assertNoDoubleBooking() {
    const active = liveGames.flatMap(g => [...g.team1, ...g.team2]);
    expect(new Set(active).size).toBe(active.length);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    const { clearAllDraftClaims } = await import('../src/Matchmaking/draftClaims');
    clearAllDraftClaims();
    liveGames = [];
    nextId = 100;
    createdTeams = [];
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId)));
    UserModel.find.mockImplementation((filter: any) => chainable(
      byId ? Object.values(byId).filter((u: any) => filter.discordId.$in.includes(u.discordId)) : []
    ));
    UserModel.findOne.mockImplementation((filter: any) => chainable(byId[filter.discordId] ?? null));
    GameModel.find.mockImplementation((filter: any) => {
      const ids = (filter?.$or ?? []).flatMap((o: any) => {
        const v = Object.values(o)[0] as any;
        return v?.$in ?? [];
      });
      return chainable(liveGames.filter(g => g.team1.concat(g.team2).some(id => ids.includes(id))));
    });
    GameModel.findOne.mockImplementation((filter: any) => {
      if (filter?.gameId) {
        const g = liveGames.find(x => x.gameId === filter.gameId);
        return chainable(g ? { ...g, channels: {} } : null);
      }
      const ids = (filter?.$or ?? []).flatMap((o: any) => {
        const v = Object.values(o)[0] as any;
        return typeof v === 'string' ? [v] : (v?.$in ?? []);
      });
      const hit = liveGames.find(g => g.team1.concat(g.team2).some(id => ids.includes(id)));
      return chainable(hit ? { gameId: hit.gameId } : null);
    });
    const gameManagerMock: any = {
      getActiveGameCount: () => 0,
      getNextGameId: async () => nextId++,
      createGame: jest.fn(async (id: number, _q: any, t1: string[], t2: string[]) => {
        liveGames.push({ gameId: id, team1: [...t1], team2: [...t2], state: 'active' });
        createdTeams.push([...t1, ...t2]);
        return { gameId: id };
      }),
      updateGameMap: jest.fn(async () => {}),
      initiateGameWarp: jest.fn(async () => {}),
    };
    const { CentralizedMatchmaker } = await import('../src/Matchmaking/CentralizedMatchmaker');
    mm = new CentralizedMatchmaker(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsMock,
      gameManagerMock
    );
    const { QueueListener } = await import('../src/handlers/QueueListener');
    listener = new QueueListener(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsMock,
      { getActiveGameCount: () => 100 } as any
    );
  });

  afterEach(() => {
    try { mm?.cleanup?.(); } catch {  }
    try { listener?.cleanup?.(); } catch {  }
  });

  async function join(u: string) {
    await listener.handleVoiceStateUpdate(voiceState(null, u), voiceState(Q1, u));
  }
  async function leave(u: string) {
    await listener.handleVoiceStateUpdate(voiceState(Q1, u), voiceState(null, u));
  }

  it('queue, draft, settle, requeue across rounds without double-booking', async () => {
    await join('a');
    await join('b');
    let r = await mm.processQueue(Q1);
    expect(r.gamesCreated).toBe(1);
    assertNoDoubleBooking();
    await leave('a');
    await leave('b');

    await join('c');
    await join('d');
    r = await mm.processQueue(Q1);
    expect(r.gamesCreated).toBe(1);
    assertNoDoubleBooking();
    expect(liveGames).toHaveLength(2);
    await leave('c');
    await leave('d');

    const [g1] = liveGames.splice(0, 1);
    expect(g1.team1.concat(g1.team2).sort()).toEqual(['a', 'b']);
    await join('e');
    await join('f');
    r = await mm.processQueue(Q1);
    expect(r.gamesCreated).toBe(1);
    expect(createdTeams.flat().filter(id => id === 'e')).toHaveLength(1);
    assertNoDoubleBooking();
    await leave('e');
    await leave('f');

    liveGames.splice(0, liveGames.length);
    await join('a');
    await join('h');
    r = await mm.processQueue(Q1);
    expect(r.gamesCreated).toBe(1);
    assertNoDoubleBooking();
    const lastGame = createdTeams[createdTeams.length - 1];
    expect(lastGame.sort()).toEqual(['a', 'h']);
  });

  it('concurrent draft and churn never double-books', async () => {
    const present = new Set(['a', 'b', 'd', 'e']);
    const guild: any = {
      channels: {
        cache: new Map([[Q1, {
          id: Q1,
          isVoiceBased: () => true,
          get members() { return new Map([...present].map(id => [id, {}])); },
        }]]),
        fetch: jest.fn().mockResolvedValue(undefined),
      },
    };
    const { CentralizedMatchmaker } = await import('../src/Matchmaking/CentralizedMatchmaker');
    const mm2 = new CentralizedMatchmaker(
      { guilds: { cache: { first: () => guild } } } as any,
      wsMock,
      (mm as any).gameManager
    );
    try {
      for (const u of ['a', 'b', 'c', 'd']) await join(u);
      const draft = mm2.processQueue(Q1);
      await join('e');
      await leave('c');
      present.delete('c');
      const result = await draft;
      expect(result.gamesCreated).toBeGreaterThanOrEqual(1);
      assertNoDoubleBooking();
      const flat = createdTeams.flat();
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat).not.toContain('c');
      expect(queuePlayers.get(Q1) || []).not.toContain('c');
    } finally {
      (mm2 as any)?.cleanup?.();
    }
  });
});
