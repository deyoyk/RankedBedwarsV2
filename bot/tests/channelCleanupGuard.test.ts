import { deleteChannelIfEmpty } from '../src/utils/channelCleanup';

function voiceChannel(id: string, members = 0, deleteImpl?: jest.Mock) {
  return {
    id,
    type: 2,
    isVoiceBased: () => true,
    members: new Map(Array.from({ length: members }, (_, index) => [`member-${index}`, {}])),
    delete: deleteImpl ?? jest.fn().mockResolvedValue(undefined),
  };
}

function textChannel(id: string, deleteImpl?: jest.Mock) {
  return {
    id,
    type: 0,
    isVoiceBased: () => false,
    delete: deleteImpl ?? jest.fn().mockResolvedValue(undefined),
  };
}

function guildWith(channel: any, voiceChannelIds: string[] = []) {
  return {
    channels: {
      cache: new Map(channel ? [[channel.id, channel]] : []),
      fetch: jest.fn(async (id: string) => (channel && id === channel.id ? channel : null)),
    },
    voiceStates: {
      cache: {
        some: (predicate: (state: { channelId: string }) => boolean) =>
          voiceChannelIds.some(channelId => predicate({ channelId })),
      },
    },
  } as any;
}

describe('deleteChannelIfEmpty', () => {
  it('never deletes an occupied voice channel', async () => {
    const channel = voiceChannel('vc', 2);
    const guild = guildWith(channel);

    expect(await deleteChannelIfEmpty(guild, 'vc', 'test')).toBe('occupied');
    expect(channel.delete).not.toHaveBeenCalled();
  });

  it('treats a live voice state as occupied even if the member cache looks empty', async () => {
    const channel = voiceChannel('vc', 0);
    const guild = guildWith(channel, ['vc']);

    expect(await deleteChannelIfEmpty(guild, 'vc', 'test')).toBe('occupied');
    expect(channel.delete).not.toHaveBeenCalled();
  });

  it('rechecks with a fresh fetch before deleting', async () => {
    const cached = voiceChannel('vc', 0);
    const occupied = voiceChannel('vc', 1);
    const guild = guildWith(cached);
    guild.channels.fetch.mockResolvedValueOnce(occupied);

    expect(await deleteChannelIfEmpty(guild, 'vc', 'test')).toBe('occupied');
    expect(cached.delete).not.toHaveBeenCalled();
  });

  it('deletes an empty voice channel', async () => {
    const channel = voiceChannel('vc', 0);
    const guild = guildWith(channel);

    expect(await deleteChannelIfEmpty(guild, 'vc', 'test')).toBe('deleted');
    expect(channel.delete).toHaveBeenCalledWith('test');
  });

  it('deletes text channels normally', async () => {
    const channel = textChannel('text');
    const guild = guildWith(channel);

    expect(await deleteChannelIfEmpty(guild, 'text', 'test')).toBe('deleted');
    expect(channel.delete).toHaveBeenCalledWith('test');
  });

  it('returns missing for channels that are already gone', async () => {
    const guild = guildWith(null);

    expect(await deleteChannelIfEmpty(guild, 'gone', 'test')).toBe('missing');
  });

  it('treats Discord unknown-channel errors as already deleted', async () => {
    const channel = textChannel('text', jest.fn().mockRejectedValue({ code: 10003 }));
    const guild = guildWith(channel);

    expect(await deleteChannelIfEmpty(guild, 'text', 'test')).toBe('missing');
  });
});
