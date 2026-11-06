import { ChannelType } from 'discord.js';
import { ChannelsCleanupTask } from '../src/tasks/ChannelsCleanupTask';
import Game from '../src/models/Game';
import Queue from '../src/models/Queue';
import PickingSessionState from '../src/models/PickingSessionState';

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    categories: {
      gameCategory: 'cat-game',
      voiceCategory: 'cat-voice',
      screenshareCategory: 'cat-ss'
    },
    channels: {
      gamesChannel: 'general',
      scoringChannel: 'config',
      voidingChannel: 'voiding',
      alertsChannel: 'alerts',
      punishmentsChannel: 'punishments',
      strikerequestsChannel: 'strikes',
      voidrequestsChannel: 'void-requests',
      screensharerequestsChannel: 'ss-requests',
      botstatusChannel: 'status'
    },
    voicechannels: {
      waitingvc: 'waiting'
    }
  }
}));
jest.mock('../src/models/Game', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../src/models/PickingSessionState', () => ({ __esModule: true, default: { find: jest.fn() } }));

const GameModel = Game as unknown as { find: jest.Mock };
const QueueModel = Queue as unknown as { find: jest.Mock };
const PickingModel = PickingSessionState as unknown as { find: jest.Mock };

function leanQuery(value: unknown) {
  return { select: () => ({ lean: async () => value }) };
}

function textChannel(id: string, name: string) {
  return {
    id,
    name,
    type: ChannelType.GuildText,
    delete: jest.fn().mockResolvedValue(undefined)
  };
}

function voiceChannel(id: string, name: string) {
  return {
    id,
    name,
    type: ChannelType.GuildVoice,
    members: new Map(),
    delete: jest.fn().mockResolvedValue(undefined)
  };
}

function category(id: string, children: Array<ReturnType<typeof textChannel> | ReturnType<typeof voiceChannel>>) {
  return {
    id,
    type: ChannelType.GuildCategory,
    children: {
      cache: new Map(children.map(channel => [channel.id, channel]))
    }
  };
}

describe('ChannelsCleanupTask', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    GameModel.find.mockReturnValue(leanQuery([]));
    QueueModel.find.mockReturnValue(leanQuery([]));
    PickingModel.find.mockReturnValue(leanQuery([]));
  });

  it('keeps configured channels and ignores channels the bot did not create', async () => {
    const general = textChannel('general', 'general');
    const status = textChannel('status', 'config');
    const rules = textChannel('rules', 'rules');
    const active = textChannel('game-1000', 'game-1000');
    const orphan = textChannel('game-999', 'game-999');
    const waiting = voiceChannel('waiting', 'Waiting');
    const userVoice = voiceChannel('user-voice', 'Community');
    const orphanVoice = voiceChannel('voice-999', 'Team 1 - Game 999');

    const gameCategory = category('cat-game', [general, status, rules, active, orphan]);
    const voiceCategory = category('cat-voice', [waiting, userVoice, orphanVoice]);
    const categories = new Map<string, unknown>([
      [gameCategory.id, gameCategory],
      [voiceCategory.id, voiceCategory]
    ]);
    const guild = {
      channels: {
        fetch: jest.fn(async (id?: string) => id ? categories.get(id) : categories)
      }
    };

    GameModel.find.mockReturnValue(leanQuery([{ channels: { text: 'game-1000' } }]));

    const task = new ChannelsCleanupTask({ guilds: { cache: { first: () => guild } } } as any);
    await (task as any).cleanupOrphanedChannels();

    expect(orphan.delete).toHaveBeenCalledTimes(1);
    expect(orphanVoice.delete).toHaveBeenCalledTimes(1);
    expect(general.delete).not.toHaveBeenCalled();
    expect(status.delete).not.toHaveBeenCalled();
    expect(rules.delete).not.toHaveBeenCalled();
    expect(active.delete).not.toHaveBeenCalled();
    expect(waiting.delete).not.toHaveBeenCalled();
    expect(userVoice.delete).not.toHaveBeenCalled();
  });

  it('keeps channels referenced by active queues and picking sessions', async () => {
    const queueChannel = textChannel('queue-1', 'game-123');
    const pickingGame = textChannel('pick-game', 'game-456');
    const pickingVoice = voiceChannel('pick-voice', 'picking-456');
    const gameCategory = category('cat-game', [queueChannel, pickingGame]);
    const voiceCategory = category('cat-voice', [pickingVoice]);
    const categories = new Map<string, unknown>([
      [gameCategory.id, gameCategory],
      [voiceCategory.id, voiceCategory]
    ]);
    const guild = {
      channels: {
        fetch: jest.fn(async (id?: string) => id ? categories.get(id) : categories)
      }
    };

    QueueModel.find.mockReturnValue(leanQuery([{ channelId: 'queue-1' }]));
    PickingModel.find.mockReturnValue(leanQuery([{ channels: { game: 'pick-game', picking: 'pick-voice' } }]));

    const task = new ChannelsCleanupTask({ guilds: { cache: { first: () => guild } } } as any);
    await (task as any).cleanupOrphanedChannels();

    expect(queueChannel.delete).not.toHaveBeenCalled();
    expect(pickingGame.delete).not.toHaveBeenCalled();
    expect(pickingVoice.delete).not.toHaveBeenCalled();
  });
});
