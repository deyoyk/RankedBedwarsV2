import { queuePlayers } from '../src/types/queuePlayersMemory';
import { claimPlayers, releasePlayers, isClaimedByOther, clearAllDraftClaims } from '../src/Matchmaking/draftClaims';

const UID = '123456789012345678';
const Q1 = '1352587524475713619';
const Q2 = '1352587524475713620';

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

function queueDoc(channelId: string) {
  return {
    channelId,
    maxPlayers: 8,
    minElo: 0,
    maxElo: 3000,
    isActive: true,
    isRanked: true,
    isPicking: false,
    queueType: 'random',
    bypassRoles: [],
  };
}

function voiceState(channelId: string | null, userId: string = UID) {
  return {
    channelId,
    member: {
      id: userId,
      user: { username: 'Tester' },
      roles: { cache: new Map() },
      voice: { channelId },
    },
  } as any;
}

describe('draftClaims registry', () => {
  beforeEach(() => clearAllDraftClaims());

  it('claims for one queue and blocks others', () => {
    expect(claimPlayers(['a', 'b'], 'q1')).toEqual(['a', 'b']);
    expect(isClaimedByOther('a', 'q2')).toBe(true);
    expect(isClaimedByOther('a', 'q1')).toBe(false);
    expect(claimPlayers(['a', 'c'], 'q2')).toEqual(['c']);
  });

  it('release frees claims only for the owner', () => {
    claimPlayers(['a'], 'q1');
    releasePlayers(['a'], 'q2');
    expect(isClaimedByOther('a', 'q2')).toBe(true);
    releasePlayers(['a'], 'q1');
    expect(isClaimedByOther('a', 'q2')).toBe(false);
  });

  it('claims expire after ttl', async () => {
    claimPlayers(['a'], 'q1', 30);
    expect(isClaimedByOther('a', 'q2')).toBe(true);
    await new Promise(r => setTimeout(r, 60));
    expect(isClaimedByOther('a', 'q2')).toBe(false);
  });
});

describe('QueueListener admission guards', () => {
  let listener: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    queuePlayers.clear();
    QueueModel.findOne.mockImplementation((filter: any) => chainable(queueDoc(filter.channelId)));
    UserModel.findOne.mockImplementation(() => chainable({
      discordId: UID, ign: 'Steve', partyId: null, elo: 1000, isBanned: false, isFrozen: false,
    }));
    GameModel.findOne.mockImplementation(() => chainable(null));
    const { QueueListener } = await import('../src/handlers/QueueListener');
    listener = new QueueListener(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsManagerMock,
      {} as any
    );
  });

  afterEach(() => {
    try {
      (listener?.matchmaker as any)?.cleanup?.();
    } catch { /* ignore */ }
  });

  it('concurrent double join yields a single queue entry', async () => {
    const oldS = voiceState(null);
    const newS = voiceState(Q1);
    await Promise.all([
      listener.handleVoiceStateUpdate(oldS, newS),
      listener.handleVoiceStateUpdate(oldS, voiceState(Q1)),
    ]);
    const listed = queuePlayers.get(Q1) || [];
    expect(listed.filter(id => id === UID)).toHaveLength(1);
    const state = (listener.queueStates as Map<string, any>).get(Q1);
    expect(state.players.filter((id: string) => id === UID)).toHaveLength(1);
  });

  it('joining a second queue removes the player from the first', async () => {
    await listener.handleVoiceStateUpdate(voiceState(null), voiceState(Q1));
    expect(queuePlayers.get(Q1)).toContain(UID);
    await listener.handleVoiceStateUpdate(voiceState(Q1), voiceState(Q2));
    expect(queuePlayers.get(Q1) || []).not.toContain(UID);
    expect(queuePlayers.get(Q2)).toContain(UID);
  });

  it('solo join while in an active game is rejected', async () => {
    GameModel.findOne.mockImplementation(() => chainable({ gameId: 7 }));
    await listener.handleVoiceStateUpdate(voiceState(null), voiceState(Q1));
    expect(queuePlayers.get(Q1) || []).not.toContain(UID);
  });
});

describe('CentralizedMatchmaker draft guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queuePlayers.clear();
    clearAllDraftClaims();
  });

  it('drops duplicate and in-game players before drafting', async () => {
    const { CentralizedMatchmaker } = await import('../src/Matchmaking/CentralizedMatchmaker');
    const queue = { ...queueDoc(Q1), maxPlayers: 2 };
    QueueModel.findOne.mockImplementation(() => ({ lean: async () => queue }));
    const users = [
      { discordId: 'a', ign: 'A', partyId: null, elo: 1000, isBanned: false, isFrozen: false },
      { discordId: 'b', ign: 'B', partyId: null, elo: 1000, isBanned: false, isFrozen: false },
    ];
    UserModel.find.mockResolvedValue(users);
    GameModel.find.mockResolvedValue([{ team1: ['a'], team2: ['x'], state: 'active' }]);
    const mm = new CentralizedMatchmaker(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsManagerMock,
      { getActiveGameCount: () => 0 } as any
    );
    try {
      queuePlayers.set(Q1, ['a', 'a', 'b']);
      const result = await mm.processQueue(Q1);
      expect(result.gamesCreated).toBe(0);
      expect(queuePlayers.get(Q1) || []).not.toContain('a');
      expect(queuePlayers.get(Q1)).toContain('b');
    } finally {
      (mm as any).cleanup?.();
    }
  });

  it('does not draft a player claimed by another queue run', async () => {
    const { CentralizedMatchmaker } = await import('../src/Matchmaking/CentralizedMatchmaker');
    claimPlayers(['a'], 'other-queue');
    const queue = { ...queueDoc(Q1), maxPlayers: 2 };
    QueueModel.findOne.mockImplementation(() => ({ lean: async () => queue }));
    UserModel.find.mockResolvedValue([
      { discordId: 'a', ign: 'A', partyId: null, elo: 1000, isBanned: false, isFrozen: false },
      { discordId: 'b', ign: 'B', partyId: null, elo: 1000, isBanned: false, isFrozen: false },
    ]);
    GameModel.find.mockResolvedValue([]);
    const mm = new CentralizedMatchmaker(
      { guilds: { cache: { first: () => undefined } } } as any,
      wsManagerMock,
      { getActiveGameCount: () => 0 } as any
    );
    try {
      queuePlayers.set(Q1, ['a', 'b']);
      const result = await mm.processQueue(Q1);
      expect(result.gamesCreated).toBe(0);
    } finally {
      (mm as any).cleanup?.();
    }
  });
});

describe('WebSocket queuefromingame guards', () => {
  const servers: Array<{ close: (cb?: () => void) => void }> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    queuePlayers.clear();
  });

  afterEach(() => {
    for (const server of servers.splice(0)) {
      try {
        server.close();
      } catch { /* ignore */ }
    }
  });

  async function makeWs() {
    const { WebSocketManager } = await import('../src/websocket/WebSocketManager');
    const guild: any = {
      id: 'guild1',
      members: {
        cache: new Map(),
        fetch: jest.fn().mockResolvedValue({
          id: UID,
          voice: { channel: { id: 'vc1' }, setChannel: jest.fn().mockResolvedValue(undefined) },
        }),
      },
      channels: {
        cache: new Map([[Q1, { id: Q1, isVoiceBased: () => true, name: 'queue-1' }]]),
        fetch: jest.fn().mockResolvedValue({ id: Q1, isVoiceBased: () => true, name: 'queue-1' }),
      },
    };
    guild.members.cache.set(UID, {
      id: UID,
      voice: { channel: { id: 'vc1' }, setChannel: jest.fn().mockResolvedValue(undefined) },
    });
    const discordClient: any = { guilds: { cache: { first: () => guild } } };
    const ws = new WebSocketManager(0, discordClient);
    (ws as any).send = jest.fn();
    const httpServer = (ws as any).server;
    if (httpServer && typeof httpServer.close === 'function') {
      servers.push(httpServer);
    }
    return { ws: ws as any, guild };
  }

  function mockDb(activeGame: any, elo = 1000) {
    UserModel.findOne.mockImplementation(() => ({
      collation: () => ({ select: () => ({ lean: async () => ({ discordId: UID, elo, ign: 'Steve' }) }) }),
    }));
    QueueModel.find.mockImplementation(() => chainable([
      { channelId: Q1, minElo: 0, maxElo: 9999, maxPlayers: 8, isRanked: false },
    ]));
    GameModel.findOne.mockImplementation(() => ({
      select: () => ({ lean: async () => activeGame }),
      lean: async () => activeGame,
    }));
  }

  it('rejects when the player is already in a game', async () => {
    const { ws } = await makeWs();
    mockDb({ gameId: 9 });
    await (ws as any).handleQueueFromInGame({ ign: 'Steve', uuid: 'u1' });
    const sent = (ws.send as jest.Mock).mock.calls.map(c => c[0]);
    expect(sent.some((p: any) => p.type === 'queuefromingame_fail' && /already in game #9/.test(p.reason))).toBe(true);
    expect(queuePlayers.get(Q1) || []).not.toContain(UID);
  });

  it('is a no-op success when already queued', async () => {
    const { ws } = await makeWs();
    mockDb(null);
    queuePlayers.set(Q1, [UID]);
    await (ws as any).handleQueueFromInGame({ ign: 'Steve', uuid: 'u2' });
    const sent = (ws.send as jest.Mock).mock.calls.map(c => c[0]);
    expect(sent.some((p: any) => p.type === 'queuefromingame_success')).toBe(true);
    expect(queuePlayers.get(Q1)?.filter(id => id === UID)).toHaveLength(1);
  });

  it('removes the player from other queues on move', async () => {
    const { ws } = await makeWs();
    mockDb(null);
    queuePlayers.set(Q2, [UID]);
    await (ws as any).handleQueueFromInGame({ ign: 'Steve', uuid: 'u3' });
    expect(queuePlayers.get(Q2) || []).not.toContain(UID);
    expect(queuePlayers.get(Q1)).toContain(UID);
  });

  it('moves every member of an in-game party into the queue', async () => {
    const UID2 = '123456789012345679';
    const { ws, guild } = await makeWs();
    const secondChannel = { id: 'vc2' };
    guild.members.cache.set(UID2, {
      id: UID2,
      voice: { channel: secondChannel, setChannel: jest.fn().mockResolvedValue(undefined) },
      roles: { cache: { has: () => false } },
    });
    guild.members.cache.get(UID).roles = { cache: { has: () => false } };

    UserModel.findOne.mockReturnValue({
      collation: () => ({
        select: () => ({
          lean: async () => ({ discordId: UID, elo: 1000, ign: 'Steve', partyId: 'P' }),
        }),
      }),
    });
    UserModel.find.mockReturnValue({
      select: () => ({
        lean: async () => [
          { discordId: UID, ign: 'Steve', elo: 1000, isBanned: false, isFrozen: false },
          { discordId: UID2, ign: 'Alex', elo: 1100, isBanned: false, isFrozen: false },
        ],
      }),
    });
    PartyModel.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ partyId: 'P', members: [UID, UID2] }) }),
    });
    GameModel.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    QueueModel.find.mockReturnValue(chainable([
      { channelId: Q1, minElo: 0, maxElo: 9999, maxPlayers: 8, isRanked: false },
    ]));

    await (ws as any).handleQueueFromInGame({ ign: 'Steve', uuid: 'party-1' });

    expect(guild.members.cache.get(UID).voice.setChannel).toHaveBeenCalled();
    expect(guild.members.cache.get(UID2).voice.setChannel).toHaveBeenCalled();
    expect(queuePlayers.get(Q1)).toEqual(expect.arrayContaining([UID, UID2]));
    const sent = (ws.send as jest.Mock).mock.calls.map(c => c[0]);
    expect(sent.some((p: any) => p.type === 'queuefromingame_success')).toBe(true);
  });

  it('rejects an in-game party when a member is not in voice', async () => {
    const UID2 = '123456789012345680';
    const { ws, guild } = await makeWs();
    guild.members.cache.set(UID2, {
      id: UID2,
      voice: { channel: null, setChannel: jest.fn() },
      roles: { cache: { has: () => false } },
    });
    guild.members.cache.get(UID).roles = { cache: { has: () => false } };

    UserModel.findOne.mockReturnValue({
      collation: () => ({
        select: () => ({
          lean: async () => ({ discordId: UID, elo: 1000, ign: 'Steve', partyId: 'P' }),
        }),
      }),
    });
    UserModel.find.mockReturnValue({
      select: () => ({
        lean: async () => [
          { discordId: UID, ign: 'Steve', elo: 1000, isBanned: false, isFrozen: false },
          { discordId: UID2, ign: 'Alex', elo: 1100, isBanned: false, isFrozen: false },
        ],
      }),
    });
    PartyModel.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ partyId: 'P', members: [UID, UID2] }) }),
    });
    GameModel.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    QueueModel.find.mockReturnValue(chainable([
      { channelId: Q1, minElo: 0, maxElo: 9999, maxPlayers: 8, isRanked: false },
    ]));

    await (ws as any).handleQueueFromInGame({ ign: 'Steve', uuid: 'party-2' });

    expect(guild.members.cache.get(UID).voice.setChannel).not.toHaveBeenCalled();
    const sent = (ws.send as jest.Mock).mock.calls.map(c => c[0]);
    expect(sent.some((p: any) => p.type === 'queuefromingame_fail' && /Alex/.test(p.reason))).toBe(true);
  });
});
