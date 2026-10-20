import { QueueListener } from '../src/handlers/QueueListener';
import { PresenceService } from '../src/services/PresenceService';
import { queuePlayers } from '../src/types/queuePlayersMemory';

jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));
jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    prefix: '!',
    prefixenabled: true,
    serverip: 'localhost',
    CommonPartySize: 1,
    PartyQueueSize: 1,
    roles: { partyof2Queue: '', partyof3Queue: '', partyof4Queue: '' },
    voicechannels: { waitingvc: 'waiting1' },
    channels: { alertsChannel: 'alerts1' },
  },
}));
jest.mock('../src/managers/WorkersManager', () => {
  const moveMembers = jest.fn().mockResolvedValue([]);
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  return {
    WorkersManager: {
      getInstance: () => ({
        createChannel: jest.fn(),
        deleteChannel: jest.fn(),
        moveMembers,
        setMemberNickname: jest.fn(),
        updateMemberRoles: jest.fn(),
        sendMessage,
      }),
      __mocks: { moveMembers, sendMessage },
    },
  };
});

const QueueModel = require('../src/models/Queue').default;
const UserModel = require('../src/models/User').default;
const { WorkersManager } = require('../src/managers/WorkersManager');
const workerMocks = WorkersManager.__mocks;

const QUEUE_ID = 'queue1';
const queueDoc = {
  channelId: QUEUE_ID, maxPlayers: 2, minElo: 0, maxElo: 9999, isActive: true,
};

const userDocs: Record<string, any> = {
  a: { discordId: 'a', ign: 'Alice', partyId: null },
  b: { discordId: 'b', ign: 'Bob', partyId: null },
  c: { discordId: 'c', ign: 'Cara', partyId: 'P' },
  d: { discordId: 'd', ign: 'Dan', partyId: 'P' },
};

function member(id: string) {
  return {
    id,
    user: { username: id },
    voice: { channelId: QUEUE_ID },
    roles: { cache: { has: () => false } },
  };
}

function setupVoice(ids: string[]) {
  const members = new Map(ids.map((id) => [id, member(id)]));
  const voiceChannel = { isVoiceBased: () => true, members };
  return {
    channels: { fetch: jest.fn().mockResolvedValue(voiceChannel) },
    members: { fetch: jest.fn().mockImplementation(async (id: string) => member(id)) },
  };
}

function makeListener(guild: any) {
  const client: any = { guilds: { cache: { first: () => guild } } };
  const listener = new QueueListener(client, { checkPlayerOnline: jest.fn() } as any, {} as any) as any;
  clearInterval(listener.matchmaker.queueMonitorInterval);
  clearInterval(listener.matchmaker.cacheCleanupInterval);
  return listener;
}

function seedQueue(listener: any, players: string[], parties?: Map<string, string[]>) {
  listener.queueStates.set(QUEUE_ID, {
    players: [...players],
    parties: parties ?? new Map(),
    lastUpdate: 0,
    processing: false,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  PresenceService.clear();
  queuePlayers.clear();
  QueueModel.findOne.mockResolvedValue(queueDoc);
  UserModel.find.mockImplementation((query: any) => {
    const ids: string[] = query?.discordId?.$in ?? [];
    const rows = ids.map((id) => userDocs[id]).filter(Boolean);
    return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) }) };
  });
});

describe('QueueListener offline eviction', () => {
  it('evicts a queued player who went offline in Minecraft', async () => {
    const guild = setupVoice(['a', 'b']);
    const listener = makeListener(guild);
    seedQueue(listener, ['a', 'b']);
    PresenceService.ingest('Bob', false);

    await listener.validateQueueState(QUEUE_ID);

    const state = listener.queueStates.get(QUEUE_ID);
    expect(state.players).toEqual(['a']);
    expect(queuePlayers.get(QUEUE_ID)).toEqual(['a']);
    expect(workerMocks.moveMembers).toHaveBeenCalledWith(['b'], expect.anything(), expect.anything());
  });

  it('evicts the whole party when one member goes offline', async () => {
    const guild = setupVoice(['c', 'd']);
    const listener = makeListener(guild);
    seedQueue(listener, ['c', 'd'], new Map([['P', ['c', 'd']]]));
    PresenceService.ingest('Cara', false);

    await listener.validateQueueState(QUEUE_ID);

    const state = listener.queueStates.get(QUEUE_ID);
    expect(state.players).toEqual([]);
    expect(state.parties.size).toBe(0);
  });

  it('keeps everyone when all presence is unknown', async () => {
    const guild = setupVoice(['a', 'b']);
    const listener = makeListener(guild);
    seedQueue(listener, ['a', 'b']);

    await listener.validateQueueState(QUEUE_ID);

    expect(listener.queueStates.get(QUEUE_ID).players).toEqual(['a', 'b']);
  });
});
