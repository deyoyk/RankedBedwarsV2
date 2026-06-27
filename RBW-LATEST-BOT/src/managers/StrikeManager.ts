import User from '../models/User';
import config from '../config/config';
import { Guild } from 'discord.js';
import { BanManager } from './BanManager';
import { parseDuration } from '../utils/parseDuration';
import { generatePunishmentId, fetchUserWithTimeout, cleanupOperation } from './punishmentBase';
import { PunishmentOperation, createPendingOperation, sendPunishmentNotification, handleOperationError } from './punishmentHelpers';

interface StrikeManagerStats {
  totalStrikes: number;
  activeStrikes: number;
  removedStrikes: number;
  escalatedStrikes: number;
  errors: number;
}

export class StrikeManager {
  private static instance: StrikeManager;
  private pendingOperations: Map<string, PunishmentOperation> = new Map();
  private stats: StrikeManagerStats = {
    totalStrikes: 0,
    activeStrikes: 0,
    removedStrikes: 0,
    escalatedStrikes: 0,
    errors: 0
  };

  private constructor() { }

  public static getInstance(): StrikeManager {
    if (!StrikeManager.instance) {
      StrikeManager.instance = new StrikeManager();
    }
    return StrikeManager.instance;
  }

  public static async strike(guild: Guild, targetId: string, moderatorId: string, reason: string): Promise<{ strikeCount: number; actionTaken: string }> {
    const instance = StrikeManager.getInstance();
    const operation = createPendingOperation(targetId, moderatorId, reason);

    instance.pendingOperations.set(operation.id, operation);

    try {
      
      if (!targetId || !moderatorId || !reason.trim()) {
        throw new Error('Invalid strike parameters');
      }

      
      const user = await fetchUserWithTimeout(targetId);
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      const strikeId = generatePunishmentId();
      const strikeRecord = {
        id: strikeId,
        reason: reason.trim(),
        date: new Date(),
        moderator: moderatorId
      };

      user.strikes.push(strikeRecord);
      await user.save();

      const strikeCount = user.strikes.length;
      const strikeConfig = config.strikes || {};
      const action = strikeConfig[strikeCount] || strikeConfig['default'] || 'warn';

      let actionTaken = 'Warning issued';
      operation.actionTaken = actionTaken;

      try {
        if (!action || action === 'warn') {
          const promises: Promise<any>[] = [];
          sendPunishmentNotification(promises, {
            guild, targetId, moderatorId, reason, type: 'strike'
          });
          await Promise.allSettled(promises);
          actionTaken = `Warning issued (Strike ${strikeCount})`;
        } else {
          try {
            const duration = parseDuration(action);
            await BanManager.ban(guild, targetId, moderatorId, action, `Strike ${strikeCount}: ${reason}`);
            actionTaken = `Banned for ${action} (Strike ${strikeCount})`;
            instance.stats.escalatedStrikes++;
          } catch (banError) {
            console.error(`[StrikeManager] Failed to escalate strike to ban for ${targetId}:`, banError);
            const promises: Promise<any>[] = [];
            sendPunishmentNotification(promises, {
              guild, targetId, moderatorId, reason, type: 'strike'
            });
            await Promise.allSettled(promises);
            actionTaken = `Warning issued - Ban escalation failed (Strike ${strikeCount})`;
          }
        }
      } catch (embedError) {
        console.warn(`[StrikeManager] Failed to send strike embed for ${targetId}:`, embedError);
      }

      operation.status = 'completed';
      operation.actionTaken = actionTaken;
      instance.stats.totalStrikes++;
      instance.stats.activeStrikes++;

      console.log(`[StrikeManager] Successfully issued strike to ${user.ign || targetId} (${strikeId}): ${reason} - ${actionTaken}`);

      return { strikeCount, actionTaken };

    } catch (error: any) {
      operation.status = 'failed';
      instance.stats.errors++;

      console.error(`[StrikeManager] Failed to issue strike to ${targetId}:`, error);
      throw new Error(`Strike operation failed: ${error.message}`);

    } finally {
      cleanupOperation(instance.pendingOperations, operation.id);
    }
  }

  public static async unstrike(guild: Guild, targetId: string, moderatorId: string, reason = 'Strike removed'): Promise<{ strikeCount: number; removedStrike: any }> {
    const instance = StrikeManager.getInstance();
    const operation = createPendingOperation(targetId, moderatorId, reason);

    instance.pendingOperations.set(operation.id, operation);

    try {
      
      if (!targetId || !moderatorId) {
        throw new Error('Invalid unstrike parameters');
      }

      
      const user = await fetchUserWithTimeout(targetId);
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      
      if (!user.strikes || user.strikes.length === 0) {
        throw new Error('User has no strikes to remove');
      }

      
      const removedStrike = user.strikes.pop();
      await user.save();

      const strikeCount = user.strikes.length;

      
      try {
        const promises: Promise<any>[] = [];
        sendPunishmentNotification(promises, {
          guild, targetId, moderatorId, reason, type: 'unstrike'
        });
        await Promise.allSettled(promises);
      } catch (embedError) {
        console.warn(`[StrikeManager] Failed to send unstrike embed for ${targetId}:`, embedError);
        
      }

      operation.status = 'completed';
      instance.stats.removedStrikes++;
      instance.stats.activeStrikes = Math.max(0, instance.stats.activeStrikes - 1);

      console.log(`[StrikeManager] Successfully removed strike from ${user.ign || targetId}: ${reason} (${strikeCount} strikes remaining)`);

      return { strikeCount, removedStrike };

    } catch (error: any) {
      operation.status = 'failed';
      instance.stats.errors++;

      console.error(`[StrikeManager] Failed to remove strike from ${targetId}:`, error);
      throw new Error(`Unstrike operation failed: ${error.message}`);

    } finally {
      cleanupOperation(instance.pendingOperations, operation.id);
    }
  }

}