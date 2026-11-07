import { BotStatusTask, STATUS_EMBED_TITLE } from '../src/tasks/BotStatusTask';

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    channels: { botstatusChannel: 'status-channel' },
  },
}));

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
        embeds: [{ title: STATUS_EMBED_TITLE }],
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

  it('renders the status overview without the removed gif attachment', async () => {
    const channel = channelMock();
    const task = taskWith(channel);

    await task.start();

    const payload = channel.send.mock.calls[0][0];
    const embed = payload.embeds[0].toJSON();

    expect(payload.files).toBeUndefined();
    expect(embed.image).toBeUndefined();
    expect(embed.title).toMatch(/^(Info|Warning|Error): Bot Environment Status$/);
    expect(embed.description).toBeTruthy();
    expect(embed.fields).toHaveLength(6);
    expect(embed.fields?.map((field: any) => field.name)).toEqual([
      'Queues',
      'Connection',
      'Arenas',
      'Host',
      'Runtime',
      'Database',
    ]);
    const host = embed.fields?.find((field: any) => field.name === 'Host')?.value ?? '';
    expect(host).toMatch(/CPU • `\d+(\.\d+)?%`/);
    expect(host).toMatch(/Memory • `\d+%`/);
    expect(host).not.toContain('█');
    expect(embed.timestamp).toBeDefined();
    task.stop();
  });

  it('keeps retrying when the initial status post fails', async () => {
    const channel = channelMock();
    channel.send.mockRejectedValueOnce(new Error('Discord unavailable'));
    const task = taskWith(channel);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await task.start();
    expect((task as any).updateInterval).not.toBeNull();

    await task.updateStatusEmbed();

    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.store.size).toBe(1);

    task.stop();
    error.mockRestore();
    warn.mockRestore();
  });

  it('does not adopt a command reply embed', async () => {
    const reply: any = {
      id: 'cmd-reply',
      author: { id: 'bot1' },
      embeds: [{ title: 'Win Given' }],
      edit: jest.fn().mockResolvedValue(undefined),
      attachments: { first: () => null }
    };
    const channel = channelMock([reply]);
    const task = taskWith(channel);

    await task.start();

    expect(reply.edit).not.toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.store.size).toBe(2);
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
      embeds: [{ title: STATUS_EMBED_TITLE }],
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

  it('stops polling when the status channel was deleted', async () => {
    const channel = channelMock();
    const task = taskWith(channel);
    await task.start();

    const message = [...channel.store.values()][0] as any;
    message.edit.mockRejectedValue(Object.assign(new Error('Unknown Channel'), { code: 10003 }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await task.updateStatusEmbed();

    expect((task as any).updateInterval).toBeNull();
    expect(channel.send).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    task.stop();
  });
});
