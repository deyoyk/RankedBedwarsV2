import { Client, ChannelType, CategoryChannel, Guild, TextChannel, VoiceChannel } from 'discord.js';
import Game from '../models/Game';
import Queue from '../models/Queue';
import PickingSessionState from '../models/PickingSessionState';
import config from '../config/config';
import { deleteChannelIfEmpty } from '../utils/channelCleanup';

export class ChannelsCleanupTask {
  private client: Client;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private initialCleanupTimeout: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 3 * 60 * 60 * 1000; 

  constructor(client: Client) {
    this.client = client;
  }

  public start() {
    if (this.cleanupInterval) {
      return;
    }
    this.initialCleanupTimeout = setTimeout(() => {
      this.cleanupOrphanedChannels().catch((error) => {
        console.error('[ChannelsCleanupTask] Startup cleanup failed:', error);
      });
    }, 10000);
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedChannels();
    }, this.CLEANUP_INTERVAL);

    console.log('[ChannelsCleanupTask] Started channel cleanup task (startup + every 3 hours)');
  }

  public stop() {
    if (this.initialCleanupTimeout) {
      clearTimeout(this.initialCleanupTimeout);
      this.initialCleanupTimeout = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async cleanupOrphanedChannels() {
    try {
      console.log('[ChannelsCleanupTask] Starting channel cleanup...');
      
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.error('[ChannelsCleanupTask] No guild found');
        return;
      }

      await guild.channels.fetch().catch(() => null);

      
      const activeGames = await Game.find({ state: { $in: ['pending', 'active', 'scoring'] } })
        .select('channels.text channels.picking channels.team1Voice channels.team2Voice')
        .lean();

      
      const validChannelIds = new Set<string>();
      for (const id of Object.values(config.channels)) {
        if (id) validChannelIds.add(id);
      }
      for (const id of Object.values(config.categories)) {
        if (id) validChannelIds.add(id);
      }
      for (const id of Object.values(config.voicechannels)) {
        if (id) validChannelIds.add(id);
      }
      
      for (const game of activeGames) {
        if (game.channels.text) validChannelIds.add(game.channels.text);
        if (game.channels.picking) validChannelIds.add(game.channels.picking);
        if (game.channels.team1Voice) validChannelIds.add(game.channels.team1Voice);
        if (game.channels.team2Voice) validChannelIds.add(game.channels.team2Voice);
      }

      const pickingSessions = await PickingSessionState.find()
        .select('channels.game channels.picking')
        .lean();
      for (const session of pickingSessions) {
        if (session.channels?.game) validChannelIds.add(session.channels.game);
        if (session.channels?.picking) validChannelIds.add(session.channels.picking);
      }

      const queues = await Queue.find({ isActive: true }).select('channelId').lean();
      for (const queue of queues) {
        if (queue.channelId) validChannelIds.add(queue.channelId);
      }

      
      await this.cleanupCategory(guild, config.categories.gameCategory, validChannelIds, 'game');
      
      
      await this.cleanupCategory(guild, config.categories.voiceCategory, validChannelIds, 'voice');

      await this.cleanupGameThreads(guild, validChannelIds);

      console.log('[ChannelsCleanupTask] Channel cleanup completed');
    } catch (error) {
      console.error('[ChannelsCleanupTask] Error during channel cleanup:', error);
    }
  }

  private async cleanupGameThreads(guild: Guild, validChannelIds: Set<string>): Promise<void> {
    const parentId = config.channels.gameThreadsChannel;
    if (!parentId) return;
    const parent = guild.channels.cache.get(parentId)
      ?? await guild.channels.fetch(parentId).catch(() => null);
    if (!parent || parent.type !== ChannelType.GuildText || !parent.isTextBased()) {
      console.warn(`[ChannelsCleanupTask] GAME_THREADS_CHANNEL_ID is missing or invalid: ${parentId}`);
      return;
    }

    let active;
    try {
      active = await parent.threads.fetchActive();
    } catch (error) {
      console.warn('[ChannelsCleanupTask] Could not fetch active game threads:', error);
      return;
    }

    let archived = 0;
    for (const thread of active.threads.values()) {
      if (!/^game-\d+(?:-picking)?$/i.test(thread.name)) continue;
      if (validChannelIds.has(thread.id)) continue;
      try {
        await thread.setArchived(true, 'Orphaned game thread cleanup');
        archived += 1;
      } catch (error) {
        console.warn(`[ChannelsCleanupTask] Could not archive thread ${thread.id}:`, error);
      }
    }
    if (archived > 0) {
      console.log(`[ChannelsCleanupTask] Archived ${archived} orphaned game thread(s)`);
    }
  }

  private isBotManagedChannel(channel: TextChannel | VoiceChannel): boolean {
    const name = channel.name;
    return /^game-\d+(?:-picking)?$/i.test(name)
      || /^picking-\d+$/i.test(name)
      || /^team [12] - game \d+$/i.test(name);
  }

  private async cleanupCategory(guild: Guild, categoryId: string, validChannelIds: Set<string>, categoryType: string) {
    try {
      const category = await guild.channels.fetch(categoryId) as CategoryChannel;
      if (!category || category.type !== ChannelType.GuildCategory) {
        console.warn(`[ChannelsCleanupTask] ${categoryType} category not found or invalid: ${categoryId}`);
        return;
      }

      const channelsToDelete: Array<TextChannel | VoiceChannel> = [];
      
      
      for (const [channelId, channel] of category.children.cache) {
        if (!validChannelIds.has(channelId) && this.isBotManagedChannel(channel as TextChannel | VoiceChannel)) {
          
          channelsToDelete.push(channel as TextChannel | VoiceChannel);
        }
      }

      if (channelsToDelete.length === 0) {
        console.log(`[ChannelsCleanupTask] No orphaned channels found in ${categoryType} category`);
        return;
      }

      console.log(`[ChannelsCleanupTask] Found ${channelsToDelete.length} orphaned channels in ${categoryType} category`);

      let deletedCount = 0;
      const CONCURRENCY = 3;
      for (let i = 0; i < channelsToDelete.length; i += CONCURRENCY) {
        const batch = channelsToDelete.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map((channel) =>
          deleteChannelIfEmpty(
            guild,
            channel.id,
            'Orphaned channel cleanup - not associated with any pending/active game'
          )
        ));
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled' && result.value === 'deleted') {
            console.log(`[ChannelsCleanupTask] Deleted orphaned ${batch[j].type === ChannelType.GuildText ? 'text' : 'voice'} channel: ${batch[j].name} (${batch[j].id})`);
            deletedCount++;
          } else if (result.status === 'fulfilled' && result.value === 'occupied') {
            console.log(`[ChannelsCleanupTask] Skipped occupied voice channel ${batch[j].name} (${batch[j].id})`);
          } else if (result.status === 'rejected') {
            const detail = result.reason instanceof Error ? result.reason.message : result.reason;
            console.error(`[ChannelsCleanupTask] Failed to delete channel ${batch[j].name} (${batch[j].id}):`, detail);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      console.log(`[ChannelsCleanupTask] Successfully deleted ${deletedCount}/${channelsToDelete.length} orphaned channels from ${categoryType} category`);
    } catch (error) {
      console.error(`[ChannelsCleanupTask] Error cleaning up ${categoryType} category:`, error);
    }
  }
}