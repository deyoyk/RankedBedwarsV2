import User from '../models/User';
import config from '../config/config';
import { Guild } from 'discord.js';
import { parseDuration } from '../utils/parseDuration';
import { sendPunishmentEmbed } from '../utils/punishmentEmbed';
import { generatePunishmentId, fetchUserWithTimeout, cleanupOperation } from './punishmentBase';

interface MuteOperation {
  id: string;
  targetId: string;
  moderatorId: string;
  reason: string;
  duration?: number;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
}

interface MuteManagerStats {
  totalMutes: number;
  activeMutes: number;
  expiredMutes: number;
  autoUnmutes: number;
  errors: number;
}

export class MuteManager {
  private static instance: MuteManager;
  private pendingOperations: Map<string, MuteOperation> = new Map();
  private stats: MuteManagerStats = {
    totalMutes: 0,
    activeMutes: 0,
    expiredMutes: 0,
    autoUnmutes: 0,
    errors: 0
  };
  private constructor() {}

  public static getInstance(): MuteManager {
    if (!MuteManager.instance) {
      MuteManager.instance = new MuteManager();
    }
    return MuteManager.instance;
  }

  public static async mute(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | null> {
    const instance = MuteManager.getInstance();
    const operationId = generatePunishmentId();
    
    const operation: MuteOperation = {
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

      const expires = duration ? new Date(Date.now() + duration) : null;
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

      const mutedRole = config.roles.muted;
      if (mutedRole) {
        const member = guild.members.cache.get(targetId);
        if (member) {
          promises.push(
            member.roles.add(mutedRole).catch(error => {
              console.warn(`[MuteManager] Failed to add muted role to ${targetId}:`, error.message);
            })
          );
        }
      }

      
      promises.push(
        sendPunishmentEmbed({
          guild, targetId, moderatorId, reason, type: 'mute', expires
        }).catch(error => {
          console.warn(`[MuteManager] Failed to send mute embed:`, error.message);
        })
      );

      
      if (wsManager && typeof wsManager.send === 'function') {
        promises.push(
          Promise.resolve().then(() => {
            wsManager.send({
              type: 'botmute',
              ign: user.ign,
              reason: reason.trim(),
              duration: duration ? Math.ceil(duration / 60000) : null,
              id: muteId
            });
          }).catch(error => {
            console.warn(`[MuteManager] Failed to send WebSocket mute notification:`, error.message);
          })
        );
      }

      
      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.totalMutes++;
      instance.stats.activeMutes++;

      console.log(`[MuteManager] Successfully muted ${user.ign || targetId} (${muteId}) for ${durationStr || 'permanent'}: ${reason}`);
      
      return expires;

    } catch (error: any) {
      operation.status = 'failed';
      instance.stats.errors++;
      
      console.error(`[MuteManager] Failed to mute ${targetId}:`, error);
      throw new Error(`Mute operation failed: ${error.message}`);
      
    } finally {
      cleanupOperation(instance.pendingOperations, operationId);
    }
  }

  public static async unmute(guild: Guild, targetId: string, moderatorId: string, reason = 'Unmuted', wsManager?: any): Promise<void> {
    const instance = MuteManager.getInstance();
    const operationId = generatePunishmentId();
    
    const operation: MuteOperation = {
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

      
      const mutedRole = config.roles.muted;
      if (mutedRole) {
        const member = guild.members.cache.get(targetId);
        if (member) {
          promises.push(
            member.roles.remove(mutedRole).catch(error => {
              console.warn(`[MuteManager] Failed to remove muted role from ${targetId}:`, error.message);
            })
          );
        }
      }

      
      promises.push(
        sendPunishmentEmbed({
          guild, targetId, moderatorId, reason, type: 'unmute'
        }).catch(error => {
          console.warn(`[MuteManager] Failed to send unmute embed:`, error.message);
        })
      );

      
      if (wsManager && typeof wsManager.send === 'function') {
        promises.push(
          Promise.resolve().then(() => {
            wsManager.send({
              type: 'botunmute',
              ign: user.ign,
              reason: reason.trim(),
              id: targetId
            });
          }).catch(error => {
            console.warn(`[MuteManager] Failed to send WebSocket unmute notification:`, error.message);
          })
        );
      }

      
      await Promise.allSettled(promises);

      operation.status = 'completed';
      instance.stats.activeMutes = Math.max(0, instance.stats.activeMutes - 1);

      console.log(`[MuteManager] Successfully unmuted ${user.ign || targetId}: ${reason}`);

    } catch (error: any) {
      operation.status = 'failed';
      instance.stats.errors++;
      
      console.error(`[MuteManager] Failed to unmute ${targetId}:`, error);
      throw new Error(`Unmute operation failed: ${error.message}`);
      
    } finally {
      cleanupOperation(instance.pendingOperations, operationId);
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

      
      const batchSize = 8; 
      for (let i = 0; i < expiredUsers.length; i += batchSize) {
        const batch = expiredUsers.slice(i, i + batchSize);
        const unmutePromises = batch.map(async ({ user, lastMute }) => {
          try {
            await MuteManager.unmute(guild, user.discordId, 'system', 'Mute expired');
            console.log(`[MuteManager] Auto-unmuted ${user.ign || user.discordId} (expired: ${lastMute.date})`);
            return true;
          } catch (error) {
            console.error(`[MuteManager] Failed to auto-unmute ${user.discordId}:`, error);
            instance.stats.errors++;
            return false;
          }
        });

        const results = await Promise.allSettled(unmutePromises);
        unmuteCount += results.filter(result => 
          result.status === 'fulfilled' && result.value === true
        ).length;

        
        if (i + batchSize < expiredUsers.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      instance.stats.expiredMutes += unmuteCount;
      
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