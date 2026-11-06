import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';

export type ChannelDeleteResult = 'deleted' | 'occupied' | 'missing';

function isVoiceBased(channel: GuildBasedChannel | null | undefined): boolean {
  if (!channel) return false;
  const candidate = channel as GuildBasedChannel & { isVoiceBased?: () => boolean };
  if (typeof candidate.isVoiceBased === 'function') return candidate.isVoiceBased();
  return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
}

function memberCount(channel: GuildBasedChannel | null | undefined): number {
  const members = (channel as { members?: { size?: number } } | null | undefined)?.members;
  return typeof members?.size === 'number' ? members.size : 0;
}

function isVoiceChannelOccupied(guild: Guild, channelId: string): boolean {
  const channel = guild.channels.cache.get(channelId) as GuildBasedChannel | undefined;
  if (isVoiceBased(channel) && memberCount(channel) > 0) return true;
  return guild.voiceStates?.cache?.some(state => state.channelId === channelId) === true;
}

/**
 * Deletes a channel only after checking that no member is still connected to
 * it. A voice channel is never removed while its member list or the guild's
 * live voice states still reference it. Text channels have no occupants and
 * are deleted normally.
 */
export async function deleteChannelIfEmpty(
  guild: Guild,
  channelId: string,
  reason: string
): Promise<ChannelDeleteResult> {
  const fetchChannel = guild.channels?.fetch?.bind(guild.channels);
  const cached = guild.channels?.cache?.get(channelId);
  const channel = cached ?? (fetchChannel ? await fetchChannel(channelId).catch(() => null) : null);
  if (!channel) return 'missing';

  if (isVoiceBased(channel)) {
    if (isVoiceChannelOccupied(guild, channelId)) return 'occupied';
    if (fetchChannel) {
      const fresh = await fetchChannel(channelId, { force: true }).catch(() => null);
      if (isVoiceBased(fresh) && (memberCount(fresh) > 0 || isVoiceChannelOccupied(guild, channelId))) {
        return 'occupied';
      }
    }
  }

  try {
    await channel.delete(reason);
    return 'deleted';
  } catch (error) {
    if ((error as { code?: number | string }).code === 10003) return 'missing';
    throw error;
  }
}
