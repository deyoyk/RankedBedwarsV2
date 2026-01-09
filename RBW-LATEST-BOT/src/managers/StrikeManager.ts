import User from '../models/User';
import config from '../config/config';
import { Guild, EmbedBuilder, TextChannel } from 'discord.js';
import { BanManager } from './BanManager';
import { parseDuration } from '../utils/parseDuration';
import path from 'path';
import fs from 'fs';

interface StrikeOperation {
  id: string;
  targetId: string;
  moderatorId: string;
  reason: string;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  actionTaken?: string;
}

interface StrikeManagerStats {
  totalStrikes: number;
  activeStrikes: number;
  removedStrikes: number;
  escalatedStrikes: number;
  errors: number;
}

export class StrikeManager {
  private static instance: StrikeManager;
  private pendingOperations: Map<string, StrikeOperation> = new Map();
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

  private static generateId(length = 9): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  public static async strike(guild: Guild, targetId: string, moderatorId: string, reason: string): Promise<{ strikeCount: number; actionTaken: string }> {
    const instance = StrikeManager.getInstance();
    const operationId = StrikeManager.generateId();

    const operation: StrikeOperation = {
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
        throw new Error('Invalid strike parameters');
      }

      
      const userPromise = User.findOne({ discordId: targetId });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database timeout')), 5000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as any;
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      const strikeId = StrikeManager.generateId();
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
          await StrikeManager.sendEmbed(guild, targetId, moderatorId, reason, strikeCount, 'strike');
          actionTaken = `Warning issued (Strike ${strikeCount})`;
        } else {
          try {
            const duration = parseDuration(action);
            await BanManager.ban(guild, targetId, moderatorId, action, `Strike ${strikeCount}: ${reason}`);
            actionTaken = `Banned for ${action} (Strike ${strikeCount})`;
            instance.stats.escalatedStrikes++;
          } catch (banError) {
            console.error(`[StrikeManager] Failed to escalate strike to ban for ${targetId}:`, banError);
            await StrikeManager.sendEmbed(guild, targetId, moderatorId, reason, strikeCount, 'strike');
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
      
      setTimeout(() => {
        instance.pendingOperations.delete(operationId);
      }, 5 * 60 * 1000);
    }
  }

  public static async unstrike(guild: Guild, targetId: string, moderatorId: string, reason = 'Strike removed'): Promise<{ strikeCount: number; removedStrike: any }> {
    const instance = StrikeManager.getInstance();
    const operationId = StrikeManager.generateId();

    const operation: StrikeOperation = {
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
        throw new Error('Invalid unstrike parameters');
      }

      
      const userPromise = User.findOne({ discordId: targetId });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database timeout')), 5000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as any;
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
        await StrikeManager.sendEmbed(guild, targetId, moderatorId, reason, strikeCount, 'unstrike');
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
      
      setTimeout(() => {
        instance.pendingOperations.delete(operationId);
      }, 5 * 60 * 1000);
    }
  }

  private static async sendEmbed(guild: Guild, targetId: string, moderatorId: string, reason: string, strikeCount: number, type: 'strike' | 'unstrike'): Promise<void> {
    try {
      const channelId = config.channels.punishmentsChannel;
      if (!channelId) {
        console.warn('[StrikeManager] Punishments channel not configured');
        return;
      }

      const channelPromise = guild.channels.fetch(channelId);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Channel fetch timeout')), 3000)
      );

      const channel = await Promise.race([channelPromise, timeoutPromise]).catch(() => null) as TextChannel | null;
      if (!channel || !channel.isTextBased()) {
        console.warn(`[StrikeManager] Punishments channel ${channelId} not found or not text-based`);
        return;
      }

      const isStrike = type === 'strike';
      const userMention = `<@${targetId}>`;
      const moderatorMention = moderatorId === 'system' ? 'System' :
        moderatorId === 'auto' ? 'Auto-Moderation' : `<@${moderatorId}>`;
      const reasonField = reason?.trim() || 'No reason provided';

      const strikeConfig = config.strikes || {};
      const action = strikeConfig[strikeCount] || strikeConfig['default'] || 'warn';

      const descriptionLines: string[] = [];
      descriptionLines.push(`**User:** ${userMention}`);
      descriptionLines.push(`**Reason:** \`${reasonField}\``);
      if (isStrike) {
        descriptionLines.push(`**Strike Count:** \`${strikeCount}\``);
        descriptionLines.push(`**Action:** \`${action}\``);
        descriptionLines.push(`**Staff:** ${moderatorMention}`);
      } else {
        descriptionLines.push(`**Remaining Strikes:** \`${strikeCount}\``);
        descriptionLines.push(`**Unstriked by:** ${moderatorMention}`);
      }

      const title = isStrike ? 'Strike Issued' : 'Strike Removed';
      const color = isStrike ? 0xcda12f : 0x2dd56b;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(descriptionLines.join('\n'))
        .setTimestamp();

      const assetFileName = isStrike ? 'strike.png' : 'unbanunmute.png';
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
        console.warn(`[StrikeManager] Asset not found for embed thumbnail: ${assetFileName}`);
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
            console.error(`[StrikeManager] Failed to send ${type} embed after ${maxAttempts} attempts:`, error);
            throw error;
          }

          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }

    } catch (error) {
      console.error(`[StrikeManager] Error sending ${type} embed:`, error);
    }
  }

  
  public static getStats(): StrikeManagerStats {
    return { ...StrikeManager.getInstance().stats };
  }

  public static getPendingOperations(): StrikeOperation[] {
    return Array.from(StrikeManager.getInstance().pendingOperations.values());
  }

  public static async getStrikeInfo(targetId: string): Promise<{
    strikeCount: number;
    strikes: any[];
    nextAction: string;
  } | null> {
    try {
      const user = await User.findOne({ discordId: targetId }).select('strikes').lean();
      if (!user) return null;

      const strikeCount = user.strikes?.length || 0;
      const strikeConfig = config.strikes || {};
      const nextAction = strikeConfig[strikeCount + 1] || strikeConfig['default'] || 'warn';

      return {
        strikeCount,
        strikes: user.strikes || [],
        nextAction
      };
    } catch (error) {
      console.error(`[StrikeManager] Error getting strike info for ${targetId}:`, error);
      return null;
    }
  }

  public static async clearAllStrikes(guild: Guild, targetId: string, moderatorId: string, reason = 'All strikes cleared'): Promise<number> {
    const instance = StrikeManager.getInstance();

    try {
      const user = await User.findOne({ discordId: targetId });
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      const clearedCount = user.strikes?.length || 0;
      if (clearedCount === 0) {
        return 0;
      }

      user.strikes = [];
      await user.save();

      
      try {
        await StrikeManager.sendEmbed(guild, targetId, moderatorId, `${reason} (${clearedCount} strikes cleared)`, 0, 'unstrike');
      } catch (embedError) {
        console.warn(`[StrikeManager] Failed to send clear strikes embed:`, embedError);
      }

      instance.stats.removedStrikes += clearedCount;
      instance.stats.activeStrikes = Math.max(0, instance.stats.activeStrikes - clearedCount);

      console.log(`[StrikeManager] Cleared ${clearedCount} strikes from ${user.ign || targetId}: ${reason}`);
      return clearedCount;

    } catch (error) {
      console.error(`[StrikeManager] Error clearing strikes for ${targetId}:`, error);
      instance.stats.errors++;
      throw error;
    }
  }

  public static cleanup(): void {
    const instance = StrikeManager.getInstance();
    instance.pendingOperations.clear();
    console.log('[StrikeManager] Cleanup completed');
  }
}