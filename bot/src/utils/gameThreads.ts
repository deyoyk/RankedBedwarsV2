import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import config from '../config/config';

export type GameTextChannel = ThreadChannel | TextChannel;

function gameThreadsParent(guild: Guild): TextChannel | null {
  const configured = config.channels.gameThreadsChannel;
  if (!configured) return null;
  const channel = guild.channels.cache.get(configured);
  if (channel?.type === ChannelType.GuildText) return channel as TextChannel;
  return null;
}

async function fetchGameThreadsParent(guild: Guild): Promise<TextChannel | null> {
  const cached = gameThreadsParent(guild);
  if (cached) return cached;
  const configured = config.channels.gameThreadsChannel;
  if (!configured) return null;
  const channel = await guild.channels.fetch(configured).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel as TextChannel : null;
}

export async function createGameThread(
  guild: Guild,
  gameId: number,
  playerIds: string[],
  suffix?: string,
): Promise<ThreadChannel> {
  const parent = await fetchGameThreadsParent(guild);
  if (!parent) {
    throw new Error('GAME_THREADS_CHANNEL_ID is missing or is not a text channel');
  }

  const thread = await parent.threads.create({
    name: suffix ? `game-${gameId}-${suffix}` : `game-${gameId}`,
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: 1440,
    reason: `Game ${gameId} private team chat`,
  });

  const uniquePlayers = [...new Set(playerIds.filter(Boolean))];
  await Promise.allSettled(uniquePlayers.map(playerId => thread.members.add(playerId)));
  return thread;
}

/**
 * Closes a game text channel without deleting a thread. Threads are archived so
 * Discord keeps the transcript; only legacy text channels are deleted.
 */
export async function closeGameTextChannel(
  guild: Guild,
  channelId: string,
  reason: string,
): Promise<'archived' | 'deleted' | 'missing'> {
  const channel: GuildBasedChannel | null = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return 'missing';

  if (channel.isThread()) {
    try {
      if (!channel.archived) {
        await channel.setArchived(true, reason);
      }
      return 'archived';
    } catch (error) {
      console.warn(`[GameThreads] Could not archive thread ${channelId}:`, error);
      return 'missing';
    }
  }

  if (channel.isTextBased()) {
    try {
      await (channel as TextChannel).delete(reason);
      return 'deleted';
    } catch (error) {
      console.warn(`[GameThreads] Could not delete legacy text channel ${channelId}:`, error);
      return 'missing';
    }
  }

  return 'missing';
}
