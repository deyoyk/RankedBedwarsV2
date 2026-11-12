import type { Client, MessageCreateOptions, Message } from 'discord.js';
import config from '../config/config';

/** The channel for bot-commands style notices (party invites to players not in game, duel requests). */
export function botCommandsChannelId(): string {
  return config.channels.botCommandsChannel || '';
}

/** Where /call notices go: CALL_NOTIFY_CHANNEL_ID, else the bot commands channel. */
export function callNotifyChannelId(): string {
  return config.channels.callNotifyChannel || config.channels.botCommandsChannel || '';
}

/** Posts in a text channel by id. Returns the message, or null when the channel isn't set or can't be used. */
export async function postIn(client: Client | undefined, channelId: string, payload: MessageCreateOptions): Promise<Message | null> {
  if (!client || !channelId) return null;
  try {
    const guild = client.guilds.cache.first();
    const channel = guild?.channels.cache.get(channelId) ?? await guild?.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('send' in channel)) return null;
    return await channel.send(payload);
  } catch (error) {
    console.error(`[notifyChannel] Could not post in ${channelId}:`, error);
    return null;
  }
}
