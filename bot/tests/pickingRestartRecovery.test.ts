import PickingSessionState from '../src/models/PickingSessionState';
import { PickingQueueManager } from '../src/Matchmaking/PickingQueueManager';

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) }),
  },
}));

const PickingModel = PickingSessionState as unknown as {
  find: jest.Mock;
  updateOne: jest.Mock;
  deleteOne: jest.Mock;
};

function guildWithChannels() {
  const textChannel = {
    id: 'text-1',
    isTextBased: () => true,
  };
  const pickingChannel = {
    id: 'voice-1',
    isVoiceBased: () => true,
    members: new Map([
      ['a', {}],
      ['b', {}],
      ['c', {}],
      ['d', {}],
    ]),
  };
  return {
    channels: {
      cache: new Map<string, any>([
        ['text-1', textChannel],
        ['voice-1', pickingChannel],
      ]),
      fetch: jest.fn(),
    },
  };
}

describe('PickingQueueManager restart recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PickingModel.updateOne.mockResolvedValue({});
    PickingModel.deleteOne.mockResolvedValue({});
  });

  it('restores an in-progress picking session and reposts the pick prompt', async () => {
    PickingModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{
        gameId: 77,
        queueData: { channelId: 'queue-1', maxPlayers: 4, minElo: 0, maxElo: 9999, bypassRoles: [] },
        selectedMap: 'Quad',
        players: ['a', 'b', 'c', 'd'],
        captains: ['a', 'b'],
        team1: ['a'],
        team2: ['b'],
        remainingPlayers: ['c', 'd'],
        currentPicker: 'a',
        pickCount: 0,
        pickOrder: ['a', 'b', 'a'],
        partyInfo: {},
        partyPlayers: [],
        channels: { game: 'text-1', picking: 'voice-1' },
      }]),
    });

    const manager = new PickingQueueManager(
      { guilds: { cache: { first: () => guildWithChannels() } } } as any,
      {} as any,
      {} as any,
    );
    const sendEmbed = jest.spyOn(manager as any, 'sendPickingEmbed').mockResolvedValue(undefined);
    const resume = jest.spyOn(manager as any, 'resumeRecoveredPicking').mockResolvedValue(undefined);

    const count = await manager.recoverPickingSessions();

    expect(count).toBe(1);
    expect(sendEmbed).toHaveBeenCalled();
    expect(resume).toHaveBeenCalled();
    expect((manager as any).activeSessions.has(77)).toBe(true);
    manager.cleanup();
  });

  it('clears a persisted session when its channels are gone', async () => {
    PickingModel.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{
        gameId: 78,
        queueData: { channelId: 'queue-1', maxPlayers: 4, minElo: 0, maxElo: 9999, bypassRoles: [] },
        selectedMap: 'Quad',
        players: ['a', 'b', 'c', 'd'],
        captains: ['a', 'b'],
        team1: ['a'],
        team2: ['b'],
        remainingPlayers: ['c', 'd'],
        currentPicker: 'a',
        pickCount: 0,
        pickOrder: [],
        partyInfo: {},
        partyPlayers: [],
        channels: { game: 'missing-text', picking: 'missing-voice' },
      }]),
    });

    const manager = new PickingQueueManager(
      { guilds: { cache: { first: () => ({ channels: { cache: new Map(), fetch: jest.fn() } }) } } } as any,
      {} as any,
      {} as any,
    );

    const count = await manager.recoverPickingSessions();
    await new Promise(resolve => setImmediate(resolve));

    expect(count).toBe(0);
    expect((manager as any).activeSessions.has(78)).toBe(false);
  });
});
