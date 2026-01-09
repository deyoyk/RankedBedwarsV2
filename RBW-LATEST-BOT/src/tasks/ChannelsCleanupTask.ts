import { Client, ChannelType, CategoryChannel, TextChannel, VoiceChannel } from 'discord.js';
import Game from '../models/Game';
import config from '../config/config';

export class ChannelsCleanupTask {
  private client: Client;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL = 3 * 60 * 60 * 1000; 

  constructor(client: Client) {
    this.client = client;
  }

  public start() {
    
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupOrphanedChannels();
    }, this.CLEANUP_INTERVAL);

    console.log('[ChannelsCleanupTask] Started channel cleanup task (runs every 3 hours)');
  }

  public stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[ChannelsCleanupTask] Stopped channel cleanup task');
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

      
      const pendingGames = await Game.find({ state: 'pending' });
      const allValidGames = [...pendingGames];

      
      const validChannelIds = new Set<string>();
      
      for (const game of allValidGames) {
        if (game.channels.text) validChannelIds.add(game.channels.text);
        if (game.channels.picking) validChannelIds.add(game.channels.picking);
      }

      
      await this.cleanupCategory(guild, config.categories.gameCategory, validChannelIds, 'game');
      
      
      await this.cleanupCategory(guild, config.categories.voiceCategory, validChannelIds, 'voice');

      console.log('[ChannelsCleanupTask] Channel cleanup completed');
    } catch (error) {
      console.error('[ChannelsCleanupTask] Error during channel cleanup:', error);
    }
  }

  private async cleanupCategory(guild: any, categoryId: string, validChannelIds: Set<string>, categoryType: string) {
    try {
      const category = await guild.channels.fetch(categoryId) as CategoryChannel;
      if (!category || category.type !== ChannelType.GuildCategory) {
        console.warn(`[ChannelsCleanupTask] ${categoryType} category not found or invalid: ${categoryId}`);
        return;
      }

      const channelsToDelete: Array<TextChannel | VoiceChannel> = [];
      
      
      for (const [channelId, channel] of category.children.cache) {
        if (!validChannelIds.has(channelId)) {
          
          channelsToDelete.push(channel as TextChannel | VoiceChannel);
        }
      }

      if (channelsToDelete.length === 0) {
        console.log(`[ChannelsCleanupTask] No orphaned channels found in ${categoryType} category`);
        return;
      }

      console.log(`[ChannelsCleanupTask] Found ${channelsToDelete.length} orphaned channels in ${categoryType} category`);

      
      let deletedCount = 0;
      for (const channel of channelsToDelete) {
        try {
          await channel.delete(`Orphaned channel cleanup - not associated with any pending/active game`);
          console.log(`[ChannelsCleanupTask] Deleted orphaned ${channel.type === ChannelType.GuildText ? 'text' : 'voice'} channel: ${channel.name} (${channel.id})`);
          deletedCount++;
          
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (deleteError: any) {
          console.error(`[ChannelsCleanupTask] Failed to delete channel ${channel.name} (${channel.id}):`, deleteError?.message || deleteError);
        }
      }

      console.log(`[ChannelsCleanupTask] Successfully deleted ${deletedCount}/${channelsToDelete.length} orphaned channels from ${categoryType} category`);
    } catch (error) {
      console.error(`[ChannelsCleanupTask] Error cleaning up ${categoryType} category:`, error);
    }
  }

  
  public async triggerCleanup() {
    console.log('[ChannelsCleanupTask] Manual cleanup triggered');
    await this.cleanupOrphanedChannels();
  }
}