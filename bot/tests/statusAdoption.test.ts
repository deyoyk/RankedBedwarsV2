import { BotStatusTask } from '../src/tasks/BotStatusTask';

jest.mock('../src/models/Queue', () => ({
  __esModule: true,
  default: { find: jest.fn().mockResolvedValue([]) }
}));

function channelMock(messages: any[] = []) {
  const store = new Map(messages.map(m => [m.id, m]));
  return {
    isTextBased: () => true,
    send: jest.fn().mockImplementation(async () => {
      const msg: any = {
        id: `msg-${store.size + 1}`,
        author: { id: 'bot1' },
        embeds: [{}],
        edit: jest.fn().mockResolvedValue(undefined),
        attachments: { first: () => null }
      };
      store.set(msg.id, msg);
      return msg;
    }),
    messages: {
      fetch: jest.fn().mockImplementation(async () => new Map(store))
    },
    store
  };
}

function taskWith(channel: any) {
  const client: any = {
    user: { id: 'bot1' },
    guilds: { cache: { first: () => ({ channels: { fetch: async () => channel } }) } }
  };
  const wsManager: any = {
    client: null,
    getReservedMaps: () => [],
    getDisabledMaps: () => [],
    getLockedMaps: () => [],
    getAllMaps: () => []
  };
  return new BotStatusTask(client, wsManager) as any;
}

describe('BotStatusTask message adoption', () => {
  it('posts a new message when the channel has none', async () => {
    const channel = channelMock();
    const task = taskWith(channel);

    await task.start();

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.store.size).toBe(1);
    task.stop();
  });

  it('edits the previous message instead of posting on restart', async () => {
    const channel = channelMock();
    const first = taskWith(channel);
    await first.start();
    first.stop();
    expect(channel.store.size).toBe(1);

    const second = taskWith(channel);
    await second.start();
    second.stop();

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.store.size).toBe(1);
  });

  it('replaces a dead message with exactly one new post', async () => {
    const dead: any = {
      id: 'msg-old',
      author: { id: 'bot1' },
      embeds: [{}],
      edit: jest.fn().mockRejectedValue(new Error('Unknown Message'))
    };
    const channel = channelMock([dead]);
    const task = taskWith(channel);
    (channel.messages.fetch as jest.Mock).mockResolvedValueOnce(new Map([[dead.id, dead]]));
    (channel.messages.fetch as jest.Mock).mockResolvedValue(new Map());

    await task.start();
    await task.updateStatusEmbed();
    task.stop();

    expect(dead.edit).toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledTimes(1);
  });
});
