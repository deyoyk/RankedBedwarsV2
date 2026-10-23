import { QueueListener } from '../src/handlers/QueueListener';

jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn() }
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) }
}));

const QueueModel = require('../src/models/Queue').default;
const UserModel = require('../src/models/User').default;
const PartyModel = require('../src/models/Party').default;

const QUEUE_ID = 'queue1';
const queueDoc = {
  channelId: QUEUE_ID, maxPlayers: 100, minElo: 0, maxElo: 9999, isActive: true
};

const userDocs: Record<string, any> = {
  a: { discordId: 'a', partyId: 'P', elo: 1000, isBanned: false, isFrozen: false },
  b: { discordId: 'b', partyId: 'P', elo: 1100, isBanned: false, isFrozen: false },
  s: { discordId: 's', partyId: null, elo: 1200, isBanned: false, isFrozen: false }
};

function member(id: string) {
  return {
    id,
    user: { username: id },
    voice: { channelId: QUEUE_ID },
    roles: { cache: { has: () => false } }
  };
}

function setupVoice(ids: string[]) {
  const members = new Map(ids.map(id => [id, member(id)]));
  const voiceChannel = { isVoiceBased: () => true, members };
  const guild = { channels: { fetch: jest.fn().mockResolvedValue(voiceChannel) } };
  return guild;
}

function makeListener(guild: any) {
  const client: any = { guilds: { cache: { first: () => guild } } };
  const listener = new QueueListener(client, {} as any, {} as any) as any;
  clearInterval(listener.matchmaker.queueMonitorInterval);
  clearInterval(listener.matchmaker.cacheCleanupInterval);
  return listener;
}

function seedQueue(listener: any, players: string[]) {
  listener.queueStates.set(QUEUE_ID, {
    players: [...players],
    parties: new Map(),
    lastUpdate: 0,
    processing: false
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  QueueModel.findOne.mockResolvedValue(queueDoc);
  UserModel.find.mockImplementation((query: any) => {
    const ids: string[] = query?.discordId?.$in ?? [];
    const rows = ids.map(id => userDocs[id]).filter(Boolean);
    return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) }) };
  });
  PartyModel.findOne.mockImplementation(async (query: any) =>
    query?.partyId === 'P' ? { partyId: 'P', members: ['a', 'b'] } : null);
});

describe('QueueListener party rescan', () => {
  it('registers a party that formed after joining', async () => {
    const listener = makeListener(setupVoice(['a', 'b']));
    seedQueue(listener, ['a', 'b']);
    await listener.validateQueueState(QUEUE_ID);
    const state = listener.queueStates.get(QUEUE_ID);
    expect(state.parties.get('P')?.sort()).toEqual(['a', 'b']);
    expect(state.players).toContain('a');
    expect(state.players).toContain('b');
  });
  it('leaves a partial party unregistered', async () => {
    const listener = makeListener(setupVoice(['a']));
    seedQueue(listener, []);
    await listener.validateQueueState(QUEUE_ID);
    const state = listener.queueStates.get(QUEUE_ID);
    expect(state.parties.size).toBe(0);
    expect(state.players).toEqual([]);
  });
  it('does not query again when nothing changed', async () => {
    const listener = makeListener(setupVoice(['a', 'b']));
    seedQueue(listener, ['a', 'b']);
    await listener.validateQueueState(QUEUE_ID);
    const callsAfterFirstTick = UserModel.find.mock.calls.length;
    expect(callsAfterFirstTick).toBeGreaterThan(0);
    await listener.validateQueueState(QUEUE_ID);
    expect(UserModel.find.mock.calls.length).toBe(callsAfterFirstTick);
  });
  it('registers stalled arrivals sitting untracked in voice', async () => {
    const listener = makeListener(setupVoice(['a', 'b']));
    seedQueue(listener, []);
    await listener.validateQueueState(QUEUE_ID);
    const state = listener.queueStates.get(QUEUE_ID);
    expect(state.parties.get('P')?.sort()).toEqual(['a', 'b']);
    expect(state.players.sort()).toEqual(['a', 'b']);
  });
  it('ignores solo occupants without a party', async () => {
    const listener = makeListener(setupVoice(['s']));
    seedQueue(listener, []);
    await listener.validateQueueState(QUEUE_ID);
    const state = listener.queueStates.get(QUEUE_ID);
    expect(state.parties.size).toBe(0);
    expect(state.players).toEqual([]);
  });
});
