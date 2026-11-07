import { ChannelType } from 'discord.js';

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: { channels: { gameThreadsChannel: 'threads-parent' } },
}));

import config from '../src/config/config';
import { closeGameTextChannel, createGameThread } from '../src/utils/gameThreads';

const configMock = config as unknown as { channels: { gameThreadsChannel: string } };

function makeThread(id = 'thread-1') {
  return {
    id,
    archived: false,
    members: { add: jest.fn().mockResolvedValue(undefined) },
    setArchived: jest.fn().mockResolvedValue(undefined),
  };
}

function makeParent(thread: ReturnType<typeof makeThread>) {
  return {
    id: 'threads-parent',
    type: ChannelType.GuildText,
    threads: { create: jest.fn().mockResolvedValue(thread) },
  };
}

function makeGuild(options: { parent?: any; fetchedParent?: any } = {}) {
  const cache = new Map<string, any>();
  if (options.parent) cache.set('threads-parent', options.parent);
  const fetch = jest.fn(async (id: string) => {
    if (id !== 'threads-parent') return null;
    return options.fetchedParent ?? options.parent ?? null;
  });
  return {
    channels: {
      cache: { get: (id: string) => cache.get(id) ?? null },
      fetch,
    },
  } as any;
}

describe('createGameThread', () => {
  beforeEach(() => {
    configMock.channels.gameThreadsChannel = 'threads-parent';
  });

  it('creates a private thread and adds every unique player', async () => {
    const thread = makeThread();
    const parent = makeParent(thread);
    const guild = makeGuild({ parent });

    const result = await createGameThread(guild, 42, ['a', 'b', 'a', '', 'c']);

    expect(result).toBe(thread);
    expect(parent.threads.create).toHaveBeenCalledWith({
      name: 'game-42',
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: 1440,
      reason: 'Game 42 private team chat',
    });
    expect(thread.members.add.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'c']);
  });

  it('adds the suffix used by picking threads', async () => {
    const thread = makeThread();
    const parent = makeParent(thread);

    await createGameThread(makeGuild({ parent }), 7, ['a'], 'picking');

    expect(parent.threads.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'game-7-picking' }),
    );
  });

  it('fetches the parent channel when it is not cached', async () => {
    const thread = makeThread();
    const parent = makeParent(thread);
    const guild = makeGuild({ fetchedParent: parent });

    await createGameThread(guild, 3, ['a']);

    expect(guild.channels.fetch).toHaveBeenCalledWith('threads-parent');
    expect(parent.threads.create).toHaveBeenCalledTimes(1);
  });

  it('fails when GAME_THREADS_CHANNEL_ID is not configured', async () => {
    configMock.channels.gameThreadsChannel = '';

    await expect(createGameThread(makeGuild(), 1, ['a']))
      .rejects.toThrow('GAME_THREADS_CHANNEL_ID is missing or is not a text channel');
  });

  it('fails when the configured channel is missing or not a text channel', async () => {
    const voiceParent = { id: 'threads-parent', type: ChannelType.GuildVoice };
    await expect(createGameThread(makeGuild({ parent: voiceParent }), 1, ['a']))
      .rejects.toThrow('GAME_THREADS_CHANNEL_ID is missing or is not a text channel');
  });
});

describe('closeGameTextChannel', () => {
  beforeEach(() => {
    configMock.channels.gameThreadsChannel = 'threads-parent';
  });

  it('archives threads so the transcript is preserved', async () => {
    const thread = {
      id: 'thread-1',
      isThread: () => true,
      isTextBased: () => true,
      archived: false,
      setArchived: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    };
    const guild = makeGuild();
    guild.channels.cache.get = () => thread;

    await expect(closeGameTextChannel(guild, 'thread-1', 'Game 1 ended'))
      .resolves.toBe('archived');

    expect(thread.setArchived).toHaveBeenCalledWith(true, 'Game 1 ended');
    expect(thread.delete).not.toHaveBeenCalled();
  });

  it('does not re-archive an already archived thread', async () => {
    const thread = {
      id: 'thread-1',
      isThread: () => true,
      isTextBased: () => true,
      archived: true,
      setArchived: jest.fn(),
    };
    const guild = makeGuild();
    guild.channels.cache.get = () => thread;

    await expect(closeGameTextChannel(guild, 'thread-1', 'Game 1 ended'))
      .resolves.toBe('archived');

    expect(thread.setArchived).not.toHaveBeenCalled();
  });

  it('deletes legacy text channels instead of archiving them', async () => {
    const legacy = {
      id: 'legacy-1',
      isThread: () => false,
      isTextBased: () => true,
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const guild = makeGuild();
    guild.channels.cache.get = () => legacy;

    await expect(closeGameTextChannel(guild, 'legacy-1', 'Game 1 ended'))
      .resolves.toBe('deleted');

    expect(legacy.delete).toHaveBeenCalledWith('Game 1 ended');
  });

  it('returns missing for channels that no longer exist', async () => {
    const guild = makeGuild();

    await expect(closeGameTextChannel(guild, 'gone', 'Game 1 ended'))
      .resolves.toBe('missing');
  });

  it('returns missing when archiving fails without throwing', async () => {
    const thread = {
      id: 'thread-1',
      isThread: () => true,
      isTextBased: () => true,
      archived: false,
      setArchived: jest.fn().mockRejectedValue(new Error('Missing Access')),
    };
    const guild = makeGuild();
    guild.channels.cache.get = () => thread;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(closeGameTextChannel(guild, 'thread-1', 'Game 1 ended'))
      .resolves.toBe('missing');

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
