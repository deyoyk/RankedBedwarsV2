jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { find: jest.fn(), updateOne: jest.fn() },
}));
jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null), find: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../src/Matchmaking/CentralizedMatchmaker', () => ({
  __esModule: true,
  CentralizedMatchmaker: jest.fn().mockImplementation(() => ({
    cleanup: jest.fn(),
    recoverPickingSessions: jest.fn().mockResolvedValue(0),
  })),
}));

import Queue from '../src/models/Queue';
import User from '../src/models/User';
import Party from '../src/models/Party';
import { QueueListener } from '../src/handlers/QueueListener';
import { queuePlayers } from '../src/types/queuePlayersMemory';

const QueueModel = Queue as unknown as { find: jest.Mock };
const UserModel = User as unknown as { find: jest.Mock };
const PartyModel = Party as unknown as { find: jest.Mock };

function chain(value: any) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
  };
}

describe('QueueListener restart recovery', () => {
  afterEach(() => queuePlayers.clear());

  it('rebuilds queue memory from Discord voice channels', async () => {
    QueueModel.find.mockReturnValue(chain([
      { channelId: 'q1', maxPlayers: 8, minElo: 0, maxElo: 9999, isActive: true },
    ]));
    UserModel.find.mockReturnValue(chain([
      { discordId: 'solo', ign: 'Solo', partyId: null, isBanned: false, isFrozen: false },
      { discordId: 'party-a', ign: 'PartyA', partyId: 'P1', isBanned: false, isFrozen: false },
      { discordId: 'party-b', ign: 'PartyB', partyId: 'P1', isBanned: false, isFrozen: false },
      { discordId: 'incomplete', ign: 'Incomplete', partyId: 'P2', isBanned: false, isFrozen: false },
      { discordId: 'banned', ign: 'Banned', partyId: null, isBanned: true, isFrozen: false },
    ]));
    PartyModel.find.mockReturnValue(chain([
      { partyId: 'P1', members: ['party-a', 'party-b'] },
      { partyId: 'P2', members: ['incomplete', 'missing-teammate'] },
    ]));

    const voiceChannel = {
      id: 'q1',
      isVoiceBased: () => true,
      members: new Map([
        ['solo', {}],
        ['party-a', {}],
        ['party-b', {}],
        ['incomplete', {}],
        ['banned', {}],
      ]),
    };
    const guild = { channels: { cache: new Map([['q1', voiceChannel]]), fetch: jest.fn() } };
    const client = { guilds: { cache: { first: () => guild } } };

    const listener = new QueueListener(client as any, { checkPlayerOnline: jest.fn() } as any, {} as any) as any;
    await listener.initialize();

    const state = listener.queueStates.get('q1');
    expect(state.players.sort()).toEqual(['party-a', 'party-b', 'solo']);
    expect(state.parties.get('P1')).toEqual(['party-a', 'party-b']);
    expect(queuePlayers.get('q1')!.sort()).toEqual(['party-a', 'party-b', 'solo']);
    listener.cleanup();
  });

  it('updates queue voice channel status only when the count changes', async () => {
    QueueModel.find.mockReturnValue(chain([{ channelId: 'q1', maxPlayers: 8 }]));
    queuePlayers.set('q1', ['a', 'b', 'c']);

    const listener = new QueueListener(
      { guilds: { cache: { first: () => undefined } } } as any,
      { checkPlayerOnline: jest.fn() } as any,
      {} as any
    ) as any;
    listener.workersManager = { setChannelStatus: jest.fn().mockResolvedValue(undefined) };

    await listener.updateQueueStatuses();
    expect(listener.workersManager.setChannelStatus).toHaveBeenCalledWith('q1', '3/8');

    await listener.updateQueueStatuses();
    expect(listener.workersManager.setChannelStatus).toHaveBeenCalledTimes(1);

    queuePlayers.set('q1', ['a']);
    await listener.updateQueueStatuses();
    expect(listener.workersManager.setChannelStatus).toHaveBeenLastCalledWith('q1', '1/8');

    listener.cleanup();
  });
});
