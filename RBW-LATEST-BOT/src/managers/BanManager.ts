import User from '../models/User';
import config from '../config/config';
import { Guild } from 'discord.js';
import { parseDuration } from '../utils/parseDuration';
import { sendPunishmentEmbed } from '../utils/punishmentEmbed';
import { generatePunishmentId, fetchUserWithTimeout, cleanupOperation } from './punishmentBase';
import {
  PunishmentOperation,
  PunishmentManagerStats,
  createPendingOperation,
  addPunishmentRole,
  sendPunishmentNotification,
  sendWebSocketNotification,
  handleOperationError,
  batchProcessExpired
} from './punishmentHelpers';

export class BanManager {
  private static instance: BanManager;
  private pendingOperations: Map<string, PunishmentOperation> = new Map();
  private stats: PunishmentManagerStats = {
    total: 0,
    active: 0,
    expired: 0,
    autoResolved: 0,
    errors: 0
  };
  private constructor() {}

  public static getInstance(): BanManager {
    if (!BanManager.instance) {
      BanManager.instance = new BanManager();
    }
    return BanManager.instance;
  }

  public static async ban(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | undefined> {
    const instance = BanManager.getInstance();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    instance.pendingOperations.set(operation.id, operation);

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

      const expires = duration ? new Date(Date.now() + duration) : undefined;
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

      addPunishmentRole(promises, guild, targetId, config.roles.banned, 'add', 'ban');

      if (!duration) {
        promises.push(
          guild.members.ban(targetId, { reason: `${reason} - By: ${moderatorId}` }).catch(error => {
            console.warn(`[BanManager] Failed to Discord ban ${targetId}:`, error.message);
          })
        );
      }

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: 'ban', expires });
      sendWebSocketNotification(promises, wsManager, user, {
        type: 'ban',
        reason,
        duration: duration ? Math.ceil(duration / 60000) : null,
        id: banId
      }, 'ban');

      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.total++;
      instance.stats.active++;

      console.log(`[BanManager] Successfully banned ${user.ign || targetId} (${banId}) for ${durationStr || 'permanent'}: ${reason}`);
      return expires;

    } catch (error: any) {
      handleOperationError(error, operation, instance.stats, 'ban', targetId);
    } finally {
      cleanupOperation(instance.pendingOperations, operation.id);
    }
  }

  public static async unban(guild: Guild, targetId: string, moderatorId: string, reason = 'Unbanned', wsManager?: any): Promise<void> {
    const instance = BanManager.getInstance();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    instance.pendingOperations.set(operation.id, operation);

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

      addPunishmentRole(promises, guild, targetId, config.roles.banned, 'remove', 'ban');

      promises.push(
        guild.members.unban(targetId, `${reason} - By: ${moderatorId}`).catch(error => {
          console.warn(`[BanManager] Failed to Discord unban ${targetId}:`, error.message);
        })
      );

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: 'unban' });
      sendWebSocketNotification(promises, wsManager, user, {
        type: 'unban',
        reason,
        id: targetId
      }, 'ban');

      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.active = Math.max(0, instance.stats.active - 1);

      console.log(`[BanManager] Successfully unbanned ${user.ign || targetId}: ${reason}`);

    } catch (error: any) {
      handleOperationError(error, operation, instance.stats, 'unban', targetId);
    } finally {
      cleanupOperation(instance.pendingOperations, operation.id);
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

      unbanCount = await batchProcessExpired(
        expiredUsers,
        async ({ user, lastBan }) => {
          try {
            await BanManager.unban(guild, user.discordId, 'system', 'Ban expired');
            console.log(`[BanManager] Auto-unbanned ${user.ign || user.discordId} (expired: ${lastBan.date})`);
            return true;
          } catch (error) {
            console.error(`[BanManager] Failed to auto-unban ${user.discordId}:`, error);
            instance.stats.errors++;
            return false;
          }
        },
        5,
        1000
      );

      instance.stats.expired += unbanCount;

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
