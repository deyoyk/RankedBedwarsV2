import User from '../models/User';
import config from '../config/config';
import { Guild, User as DiscordUser, EmbedBuilder, TextChannel } from 'discord.js';
import { parseDuration } from '../utils/parseDuration';
import path from 'path';
import fs from 'fs';

interface BanOperation {
  id: string;
  targetId: string;
  moderatorId: string;
  reason: string;
  duration?: number;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
}

interface BanManagerStats {
  totalBans: number;
  activeBans: number;
  expiredBans: number;
  autoUnbans: number;
  errors: number;
}

export class BanManager {
  private static instance: BanManager;
  private pendingOperations: Map<string, BanOperation> = new Map();
  private stats: BanManagerStats = {
    totalBans: 0,
    activeBans: 0,
    expiredBans: 0,
    autoUnbans: 0,
    errors: 0
  };
  private autoUnbanInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startAutoUnbanScheduler();
  }

  public static getInstance(): BanManager {
    if (!BanManager.instance) {
      BanManager.instance = new BanManager();
    }
    return BanManager.instance;
  }

  private static generateId(length = 9): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private startAutoUnbanScheduler(): void {
    this.autoUnbanInterval = setInterval(async () => {
      try {
        await this.processExpiredBans();
      } catch (error) {
        console.error('[BanManager] Error in auto-unban scheduler:', error);
        this.stats.errors++;
      }
    }, 5 * 60 * 1000);
  }

  private async processExpiredBans(): Promise<void> {
    try {
      const now = new Date();
      const users = await User.find({ 
        isbanned: true,
        'bans.0': { $exists: true }
      }).select('discordId bans');

      let processedCount = 0;
      const batchSize = 10;

      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        const promises = batch.map(async (user) => {
          try {
            const lastBan = user.bans[user.bans.length - 1];
            if (lastBan && lastBan.duration > 0) {
              const banExpiry = new Date(lastBan.date.getTime() + lastBan.duration * 60000);
              if (now >= banExpiry) {
                processedCount++;
                return user.discordId;
              }
            }
          } catch (error) {
            console.error(`[BanManager] Error checking ban expiry for user ${user.discordId}:`, error);
            this.stats.errors++;
          }
          return null;
        });

        const expiredUserIds = (await Promise.allSettled(promises))
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => (result as PromiseFulfilledResult<string>).value);

        for (const userId of expiredUserIds) {
          try {
            console.log(`[BanManager] Auto-unbanning user ${userId}`);
            this.stats.autoUnbans++;
          } catch (error) {
            console.error(`[BanManager] Error auto-unbanning user ${userId}:`, error);
            this.stats.errors++;
          }
        }
      }

      if (processedCount > 0) {
        console.log(`[BanManager] Processed ${processedCount} expired bans`);
      }
    } catch (error) {
      console.error('[BanManager] Error processing expired bans:', error);
      this.stats.errors++;
    }
  }

  public static async ban(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | null> {
    const instance = BanManager.getInstance();
    const operationId = BanManager.generateId();
    
    const operation: BanOperation = {
      id: operationId,
      targetId,
      moderatorId,
      reason,
      timestamp: Date.now(),
      status: 'pending'
    };

    instance.pendingOperations.set(operationId, operation);

    try {
      if (!targetId || !moderatorId || !reason.trim()) {
        throw new Error('Invalid ban parameters');
      }

      const userPromise = User.findOne({ discordId: targetId });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database timeout')), 5000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as any;
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      if (user.isbanned) {
        console.warn(`[BanManager] User ${targetId} is already banned`);
        const lastBan = user.bans[user.bans.length - 1];
        if (lastBan) {
          lastBan.reason = reason;
          lastBan.moderator = moderatorId;
          lastBan.date = new Date();
        }
      }

      const duration = parseDuration(durationStr);
      if (duration && duration < 60000) {
        throw new Error('Ban duration must be at least 1 minute');
      }
      if (duration && duration > 365 * 24 * 60 * 60 * 1000) { 
        throw new Error('Ban duration cannot exceed 1 year');
      }

      const expires = duration ? new Date(Date.now() + duration) : null;
      const banId = BanManager.generateId();

      const banRecord = {
        id: banId,
        reason: reason.trim(),
        date: new Date(),
        duration: duration ? Math.ceil(duration / 60000) : 0,
        moderator: moderatorId
      };

      user.bans.push(banRecord);
      user.isbanned = true;
      
      await user.save();

      const promises: Promise<any>[] = [];

      const bannedRole = config.roles.banned;
      if (bannedRole) {
        const member = guild.members.cache.get(targetId);
        if (member) {
          promises.push(
            member.roles.add(bannedRole).catch(error => {
              console.warn(`[BanManager] Failed to add banned role to ${targetId}:`, error.message);
            })
          );
        }
      }

      
      if (!duration) {
        promises.push(
          guild.members.ban(targetId, { reason: `${reason} - By: ${moderatorId}` }).catch(error => {
            console.warn(`[BanManager] Failed to Discord ban ${targetId}:`, error.message);
          })
        );
      }

      
      promises.push(
        BanManager.sendEmbed(guild, targetId, moderatorId, reason, expires, 'ban').catch(error => {
          console.warn(`[BanManager] Failed to send ban embed:`, error.message);
        })
      );

      
      if (wsManager && typeof wsManager.send === 'function') {
        promises.push(
          Promise.resolve().then(() => {
            wsManager.send({
              type: 'botban',
              ign: user.ign,
              reason: reason.trim(),
              duration: duration ? Math.ceil(duration / 60000) : null,
              id: banId
            });
          }).catch(error => {
            console.warn(`[BanManager] Failed to send WebSocket ban notification:`, error.message);
          })
        );
      }

      
      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.totalBans++;
      instance.stats.activeBans++;

      console.log(`[BanManager] Successfully banned ${user.ign || targetId} (${banId}) for ${durationStr || 'permanent'}: ${reason}`);
      
      return expires;

    } catch (error: any) {
      operation.status = 'failed';
      instance.stats.errors++;
      
      console.error(`[BanManager] Failed to ban ${targetId}:`, error);
      throw new Error(`Ban operation failed: ${error.message}`);
      
    } finally {
      
      setTimeout(() => {
        instance.pendingOperations.delete(operationId);
      }, 5 * 60 * 1000);
    }
  }

  public static async unban(guild: Guild, targetId: string, moderatorId: string, reason = 'Unbanned', wsManager?: any): Promise<void> {
    const instance = BanManager.getInstance();
    const operationId = BanManager.generateId();
    
    const operation: BanOperation = {
      id: operationId,
      targetId,
      moderatorId,
      reason,
      timestamp: Date.now(),
      status: 'pending'
    };

    instance.pendingOperations.set(operationId, operation);

    try {
      
      if (!targetId || !moderatorId) {
        throw new Error('Invalid unban parameters');
      }

      
      const userPromise = User.findOne({ discordId: targetId });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database timeout')), 5000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as any;
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      
      if (!user.isbanned) {
        console.warn(`[BanManager] User ${targetId} is not currently banned`);
        return; 
      }

      
      user.isbanned = false;
      await user.save();

      
      const promises: Promise<any>[] = [];

      
      const bannedRole = config.roles.banned;
      if (bannedRole) {
        const member = guild.members.cache.get(targetId);
        if (member) {
          promises.push(
            member.roles.remove(bannedRole).catch(error => {
              console.warn(`[BanManager] Failed to remove banned role from ${targetId}:`, error.message);
            })
          );
        }
      }

      
      promises.push(
        guild.members.unban(targetId, `${reason} - By: ${moderatorId}`).catch(error => {
          console.warn(`[BanManager] Failed to Discord unban ${targetId}:`, error.message);
        })
      );

      
      promises.push(
        BanManager.sendEmbed(guild, targetId, moderatorId, reason, null, 'unban').catch(error => {
          console.warn(`[BanManager] Failed to send unban embed:`, error.message);
        })
      );

      
      if (wsManager && typeof wsManager.send === 'function') {
        promises.push(
          Promise.resolve().then(() => {
            wsManager.send({
              type: 'botunban',
              ign: user.ign,
              reason: reason.trim(),
              id: targetId
            });
          }).catch(error => {
            console.warn(`[BanManager] Failed to send WebSocket unban notification:`, error.message);
          })
        );
      }

      
      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.activeBans = Math.max(0, instance.stats.activeBans - 1);

      console.log(`[BanManager] Successfully unbanned ${user.ign || targetId}: ${reason}`);

    } catch (error: any) {
      operation.status = 'failed';
      instance.stats.errors++;
      
      console.error(`[BanManager] Failed to unban ${targetId}:`, error);
      throw new Error(`Unban operation failed: ${error.message}`);
      
    } finally {
      
      setTimeout(() => {
        instance.pendingOperations.delete(operationId);
      }, 5 * 60 * 1000);
    }
  }

  public static async autoUnban(guild: Guild): Promise<number> {
    const instance = BanManager.getInstance();
    let unbanCount = 0;

    try {
      const now = new Date();
      const users = await User.find({ 
        isbanned: true,
        'bans.0': { $exists: true }
      }).select('discordId bans ign').limit(100); 

      const expiredUsers: Array<{ user: any; lastBan: any }> = [];

      
      for (const user of users) {
        try {
          const lastBan = user.bans[user.bans.length - 1];
          if (lastBan && lastBan.duration > 0) {
            const banExpiry = new Date(lastBan.date.getTime() + lastBan.duration * 60000);
            if (now >= banExpiry) {
              expiredUsers.push({ user, lastBan });
            }
          }
        } catch (error) {
          console.error(`[BanManager] Error checking ban expiry for user ${user.discordId}:`, error);
          instance.stats.errors++;
        }
      }

      
      const batchSize = 5;
      for (let i = 0; i < expiredUsers.length; i += batchSize) {
        const batch = expiredUsers.slice(i, i + batchSize);
        const unbanPromises = batch.map(async ({ user, lastBan }) => {
          try {
            await BanManager.unban(guild, user.discordId, 'system', 'Ban expired');
            console.log(`[BanManager] Auto-unbanned ${user.ign || user.discordId} (expired: ${lastBan.date})`);
            return true;
          } catch (error) {
            console.error(`[BanManager] Failed to auto-unban ${user.discordId}:`, error);
            instance.stats.errors++;
            return false;
          }
        });

        const results = await Promise.allSettled(unbanPromises);
        unbanCount += results.filter(result => 
          result.status === 'fulfilled' && result.value === true
        ).length;

        
        if (i + batchSize < expiredUsers.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      instance.stats.expiredBans += unbanCount;
      
      if (unbanCount > 0) {
        console.log(`[BanManager] Auto-unbanned ${unbanCount} users with expired bans`);
      }

      return unbanCount;

    } catch (error) {
      console.error('[BanManager] Error in auto-unban process:', error);
      instance.stats.errors++;
      return unbanCount;
    }
  }

  private static async sendEmbed(guild: Guild, targetId: string, moderatorId: string, reason: string, expires: Date | null, type: 'ban' | 'unban'): Promise<void> {
    try {
      const channelId = config.channels.punishmentsChannel;
      if (!channelId) {
        console.warn('[BanManager] Punishments channel not configured');
        return;
      }

      
      const channelPromise = guild.channels.fetch(channelId);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Channel fetch timeout')), 3000)
      );

      const channel = await Promise.race([channelPromise, timeoutPromise]).catch(() => null) as TextChannel | null;
      if (!channel || !channel.isTextBased()) {
        console.warn(`[BanManager] Punishments channel ${channelId} not found or not text-based`);
        return;
      }

      const isBan = type === 'ban';
      const userMention = `<@${targetId}>`;
      const moderatorMention = moderatorId === 'system' ? 'System' : 
                              moderatorId === 'auto' ? 'Auto-Moderation' : `<@${moderatorId}>`;
      const reasonField = reason?.trim() || 'No reason provided';

      let durationDisplay = 'Permanent';
      let expiryDisplay: string | null = null;
      if (expires) {
        const remainingMs = Math.max(0, expires.getTime() - Date.now());
        const minutes = Math.ceil(remainingMs / 60000);
        if (minutes < 60) {
          durationDisplay = `${minutes}m`;
        } else if (minutes < 1440) {
          const hours = Math.ceil(minutes / 60);
          durationDisplay = `${hours}h`;
        } else {
          const days = Math.ceil(minutes / 1440);
          durationDisplay = `${days}d`;
        }
        const d = new Date(expires);
        expiryDisplay = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
      }

      let ign: string | undefined;
      try {
        const userDoc = await User.findOne({ discordId: targetId }).select('ign').lean();
        ign = userDoc?.ign;
      } catch (err) {}

      const title = isBan ? 'Rank Banned' : 'User Unbanned';
      const color = isBan ? 0x7b0606 : 0x2dd56b;
      const descriptionLines: string[] = [];
      descriptionLines.push(`**User:** ${userMention}${ign ? ` (${ign})` : ''}`);
      descriptionLines.push(`**Reason:** \`${reasonField}\``);
      if (isBan) {
        descriptionLines.push(`**Duration:** \`${durationDisplay}\``);
        if (expiryDisplay) descriptionLines.push(`**Ban expires at:** \`${expiryDisplay}\``);
        descriptionLines.push(`**Staff:** ${moderatorMention}`);
        descriptionLines.push('\nIf you wish to appeal this punishment, please create an appeal Support Channel and staff will be swift to help.');
      } else {
        descriptionLines.push(`**Unbanned by:** ${moderatorMention}`);
        descriptionLines.push('\nIn future if you face another punishment, it will likely increase due to your punishment history.');
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(descriptionLines.join('\n'))
        .setTimestamp();

      const assetFileName = isBan ? 'ban.png' : 'unbanunmute.png';
      const candidatePaths = [
        path.resolve(process.cwd(), 'src', 'asserts', 'punishments', assetFileName),
        path.resolve(process.cwd(), 'asserts', 'punishments', assetFileName)
      ];
      const assetPath = candidatePaths.find(p => fs.existsSync(p));
      const files: { attachment: string; name: string }[] = [];
      if (assetPath) {
        embed.setThumbnail(`attachment://${assetFileName}`);
        files.push({ attachment: assetPath, name: assetFileName });
      } else {
        console.warn(`[BanManager] Asset not found for embed thumbnail: ${assetFileName}`);
      }

      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          await channel.send({ content: userMention, embeds: [embed], files });
          break;
        } catch (error: any) {
          attempts++;
          if (attempts >= maxAttempts) {
            console.error(`[BanManager] Failed to send ${type} embed after ${maxAttempts} attempts:`, error);
            throw error;
          }
          
          
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }

    } catch (error) {
      console.error(`[BanManager] Error sending ${type} embed:`, error);
    }
  }

  
  public static getStats(): BanManagerStats {
    return { ...BanManager.getInstance().stats };
  }

  public static getPendingOperations(): BanOperation[] {
    return Array.from(BanManager.getInstance().pendingOperations.values());
  }

  public static async getBanInfo(targetId: string): Promise<{
    isBanned: boolean;
    banCount: number;
    lastBan?: any;
    timeRemaining?: number;
  } | null> {
    try {
      const user = await User.findOne({ discordId: targetId }).select('isbanned bans').lean();
      if (!user) return null;

      const result = {
        isBanned: user.isbanned || false,
        banCount: user.bans?.length || 0,
        lastBan: undefined as any,
        timeRemaining: undefined as number | undefined
      };

      if (user.bans && user.bans.length > 0) {
        const lastBan = user.bans[user.bans.length - 1];
        result.lastBan = lastBan;

        if (lastBan.duration > 0) {
          const banExpiry = new Date(lastBan.date.getTime() + lastBan.duration * 60000);
          const remaining = banExpiry.getTime() - Date.now();
          result.timeRemaining = Math.max(0, remaining);
        }
      }

      return result;
    } catch (error) {
      console.error(`[BanManager] Error getting ban info for ${targetId}:`, error);
      return null;
    }
  }

  public static cleanup(): void {
    const instance = BanManager.getInstance();
    
    if (instance.autoUnbanInterval) {
      clearInterval(instance.autoUnbanInterval);
      instance.autoUnbanInterval = null;
    }
    
    instance.pendingOperations.clear();
    console.log('[BanManager] Cleanup completed');
  }
}