import User from '../models/User';
import config from '../config/config';
import { Guild } from 'discord.js';
import { parseDuration } from '../utils/parseDuration';
import { sendPunishmentEmbed } from '../utils/punishmentEmbed';
import { generatePunishmentId, fetchUserWithTimeout, cleanupOperation } from './punishmentBase';

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
  private constructor() {}

  public static getInstance(): BanManager {
    if (!BanManager.instance) {
      BanManager.instance = new BanManager();
    }
    return BanManager.instance;
  }

  public static async ban(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | null> {
    const instance = BanManager.getInstance();
    const operationId = generatePunishmentId();
    
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

      const user = await fetchUserWithTimeout(targetId);
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
      const banId = generatePunishmentId();

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
        sendPunishmentEmbed({
          guild, targetId, moderatorId, reason, type: 'ban', expires
        }).catch(error => {
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
      cleanupOperation(instance.pendingOperations, operationId);
    }
  }

  public static async unban(guild: Guild, targetId: string, moderatorId: string, reason = 'Unbanned', wsManager?: any): Promise<void> {
    const instance = BanManager.getInstance();
    const operationId = generatePunishmentId();
    
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

      
      const user = await fetchUserWithTimeout(targetId);
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
        sendPunishmentEmbed({
          guild, targetId, moderatorId, reason, type: 'unban'
        }).catch(error => {
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
      cleanupOperation(instance.pendingOperations, operationId);
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

}