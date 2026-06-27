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

export class MuteManager {
  private static instance: MuteManager;
  private pendingOperations: Map<string, PunishmentOperation> = new Map();
  private stats: PunishmentManagerStats = {
    total: 0,
    active: 0,
    expired: 0,
    autoResolved: 0,
    errors: 0
  };
  private constructor() {}

  public static getInstance(): MuteManager {
    if (!MuteManager.instance) {
      MuteManager.instance = new MuteManager();
    }
    return MuteManager.instance;
  }

  public static async mute(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | undefined> {
    const instance = MuteManager.getInstance();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    instance.pendingOperations.set(operation.id, operation);

    try {
      if (!targetId || !moderatorId || !reason.trim()) {
        throw new Error('Invalid mute parameters');
      }

      const user = await fetchUserWithTimeout(targetId);
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      if (user.ismuted) {
        console.warn(`[MuteManager] User ${targetId} is already muted`);
        const lastMute = user.mutes[user.mutes.length - 1];
        if (lastMute) {
          lastMute.reason = reason;
          lastMute.moderator = moderatorId;
          lastMute.date = new Date();
        }
      }

      const duration = parseDuration(durationStr);
      if (duration && duration < 60000) {
        throw new Error('Mute duration must be at least 1 minute');
      }
      if (duration && duration > 30 * 24 * 60 * 60 * 1000) {
        throw new Error('Mute duration cannot exceed 30 days');
      }

      const expires = duration ? new Date(Date.now() + duration) : undefined;
      const muteId = generatePunishmentId();

      const muteRecord = {
        id: muteId,
        reason: reason.trim(),
        date: new Date(),
        duration: duration ? Math.ceil(duration / 60000) : 0,
        moderator: moderatorId
      };

      user.mutes.push(muteRecord);
      user.ismuted = true;
      await user.save();

      const promises: Promise<any>[] = [];

      addPunishmentRole(promises, guild, targetId, config.roles.muted, 'add', 'mute');

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: 'mute', expires });
      sendWebSocketNotification(promises, wsManager, user, {
        type: 'mute',
        reason,
        duration: duration ? Math.ceil(duration / 60000) : null,
        id: muteId
      }, 'mute');

      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.total++;
      instance.stats.active++;

      console.log(`[MuteManager] Successfully muted ${user.ign || targetId} (${muteId}) for ${durationStr || 'permanent'}: ${reason}`);
      return expires;

    } catch (error: any) {
      handleOperationError(error, operation, instance.stats, 'mute', targetId);
    } finally {
      cleanupOperation(instance.pendingOperations, operation.id);
    }
  }

  public static async unmute(guild: Guild, targetId: string, moderatorId: string, reason = 'Unmuted', wsManager?: any): Promise<void> {
    const instance = MuteManager.getInstance();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    instance.pendingOperations.set(operation.id, operation);

    try {
      if (!targetId || !moderatorId) {
        throw new Error('Invalid unmute parameters');
      }

      const user = await fetchUserWithTimeout(targetId);
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      if (!user.ismuted) {
        console.warn(`[MuteManager] User ${targetId} is not currently muted`);
        return;
      }

      user.ismuted = false;
      await user.save();

      const promises: Promise<any>[] = [];

      addPunishmentRole(promises, guild, targetId, config.roles.muted, 'remove', 'mute');

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: 'unmute' });
      sendWebSocketNotification(promises, wsManager, user, {
        type: 'unmute',
        reason,
        id: targetId
      }, 'mute');

      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.active = Math.max(0, instance.stats.active - 1);

      console.log(`[MuteManager] Successfully unmuted ${user.ign || targetId}: ${reason}`);

    } catch (error: any) {
      handleOperationError(error, operation, instance.stats, 'unmute', targetId);
    } finally {
      cleanupOperation(instance.pendingOperations, operation.id);
    }
  }

  public static async autoUnmute(guild: Guild): Promise<number> {
    const instance = MuteManager.getInstance();
    let unmuteCount = 0;

    try {
      const now = new Date();
      const users = await User.find({
        ismuted: true,
        'mutes.0': { $exists: true }
      }).select('discordId mutes ign').limit(100);

      const expiredUsers: Array<{ user: any; lastMute: any }> = [];

      for (const user of users) {
        try {
          const lastMute = user.mutes[user.mutes.length - 1];
          if (lastMute && lastMute.duration > 0) {
            const muteExpiry = new Date(lastMute.date.getTime() + lastMute.duration * 60000);
            if (now >= muteExpiry) {
              expiredUsers.push({ user, lastMute });
            }
          }
        } catch (error) {
          console.error(`[MuteManager] Error checking mute expiry for user ${user.discordId}:`, error);
          instance.stats.errors++;
        }
      }

      unmuteCount = await batchProcessExpired(
        expiredUsers,
        async ({ user, lastMute }) => {
          try {
            await MuteManager.unmute(guild, user.discordId, 'system', 'Mute expired');
            console.log(`[MuteManager] Auto-unmuted ${user.ign || user.discordId} (expired: ${lastMute.date})`);
            return true;
          } catch (error) {
            console.error(`[MuteManager] Failed to auto-unmute ${user.discordId}:`, error);
            instance.stats.errors++;
            return false;
          }
        },
        8,
        500
      );

      instance.stats.expired += unmuteCount;

      if (unmuteCount > 0) {
        console.log(`[MuteManager] Auto-unmuted ${unmuteCount} users with expired mutes`);
      }

      return unmuteCount;

    } catch (error) {
      console.error('[MuteManager] Error in auto-unmute process:', error);
      instance.stats.errors++;
      return unmuteCount;
    }
  }
}
