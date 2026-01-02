import User from '../models/User';
import config from '../config/config';
import { Guild, User as DiscordUser, EmbedBuilder, TextChannel } from 'discord.js';
import { parseDuration } from '../utils/parseDuration';
import path from 'path';
import fs from 'fs';

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
  private autoUnmuteInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startAutoUnmuteScheduler();
  }

  public static getInstance(): MuteManager {
    if (!MuteManager.instance) {
      MuteManager.instance = new MuteManager();
    }
    return MuteManager.instance;
  }

  private static generateId(length = 9): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private startAutoUnmuteScheduler(): void {
    
    this.autoUnmuteInterval = setInterval(async () => {
      try {
        await this.processExpiredMutes();
      } catch (error) {
        console.error('[MuteManager] Error in auto-unmute scheduler:', error);
        this.stats.errors++;
      }
    }, 2 * 60 * 1000);
  }

  private async processExpiredMutes(): Promise<void> {
    try {
      const now = new Date();
      const users = await User.find({ 
        ismuted: true,
        'mutes.0': { $exists: true }
      }).select('discordId mutes ign').limit(50);

      let processedCount = 0;
      const batchSize = 10;

      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        const promises = batch.map(async (user) => {
          try {
            const lastMute = user.mutes[user.mutes.length - 1];
            if (lastMute && lastMute.duration > 0) {
              const muteExpiry = new Date(lastMute.date.getTime() + lastMute.duration * 60000);
              if (now >= muteExpiry) {
                processedCount++;
                return user.discordId;
              }
            }
          } catch (error) {
            console.error(`[MuteManager] Error checking mute expiry for user ${user.discordId}:`, error);
            this.stats.errors++;
          }
          return null;
        });

        const expiredUserIds = (await Promise.allSettled(promises))
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => (result as PromiseFulfilledResult<string>).value);

        for (const userId of expiredUserIds) {
          try {
            console.log(`[MuteManager] Auto-unmuting user ${userId}`);
            this.stats.autoUnmutes++;
          } catch (error) {
            console.error(`[MuteManager] Error auto-unmuting user ${userId}:`, error);
            this.stats.errors++;
          }
        }
      }

      if (processedCount > 0) {
        console.log(`[MuteManager] Processed ${processedCount} expired mutes`);
      }
    } catch (error) {
      console.error('[MuteManager] Error processing expired mutes:', error);
      this.stats.errors++;
    }
  }

  public static async mute(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | null> {
    const instance = MuteManager.getInstance();
    const operationId = MuteManager.generateId();
    
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

      
      const userPromise = User.findOne({ discordId: targetId });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database timeout')), 5000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as any;
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
      const muteId = MuteManager.generateId();

      
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
        MuteManager.sendEmbed(guild, targetId, moderatorId, reason, expires, 'mute').catch(error => {
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
      
      setTimeout(() => {
        instance.pendingOperations.delete(operationId);
      }, 5 * 60 * 1000);
    }
  }

  public static async unmute(guild: Guild, targetId: string, moderatorId: string, reason = 'Unmuted', wsManager?: any): Promise<void> {
    const instance = MuteManager.getInstance();
    const operationId = MuteManager.generateId();
    
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

      
      const userPromise = User.findOne({ discordId: targetId });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database timeout')), 5000)
      );

      const user = await Promise.race([userPromise, timeoutPromise]) as any;
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
        MuteManager.sendEmbed(guild, targetId, moderatorId, reason, null, 'unmute').catch(error => {
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
      
      setTimeout(() => {
        instance.pendingOperations.delete(operationId);
      }, 5 * 60 * 1000);
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

  private static async sendEmbed(guild: Guild, targetId: string, moderatorId: string, reason: string, expires: Date | null, type: 'mute' | 'unmute'): Promise<void> {
    try {
      const channelId = config.channels.punishmentsChannel;
      if (!channelId) {
        console.warn('[MuteManager] Punishments channel not configured');
        return;
      }

      const channelPromise = guild.channels.fetch(channelId);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Channel fetch timeout')), 3000)
      );

      const channel = await Promise.race([channelPromise, timeoutPromise]).catch(() => null) as TextChannel | null;
      if (!channel || !channel.isTextBased()) {
        console.warn(`[MuteManager] Punishments channel ${channelId} not found or not text-based`);
        return;
      }

      const isMute = type === 'mute';
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
      } catch (_) {}

      const title = isMute ? 'Muted' : 'User Unmuted';
      const color = isMute ? 0xff9900 : 0x2dd56b;
      const descriptionLines: string[] = [];
      descriptionLines.push(`**User:** ${userMention}${ign ? ` (${ign})` : ''}`);
      descriptionLines.push(`**Reason:** \`${reasonField}\``);
      if (isMute) {
        descriptionLines.push(`**Duration:** \`${durationDisplay}\``);
        if (expiryDisplay) descriptionLines.push(`**Mute expires at:** \`${expiryDisplay}\``);
        descriptionLines.push(`**Staff:** ${moderatorMention}`);
        descriptionLines.push('\nIf you wish to appeal this punishment, please create an appeal Support Channel and staff will be swift to help.');
      } else {
        descriptionLines.push(`**Unmuted by:** ${moderatorMention}`);
        descriptionLines.push('\nIn future if you face another punishment, it will likely increase due to your punishment history.');
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(descriptionLines.join('\n'))
        .setTimestamp();

      
      const assetFileName = isMute ? 'ban.png' : 'unbanunmute.png';
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
        console.warn(`[MuteManager] Asset not found for embed thumbnail: ${assetFileName}`);
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
            console.error(`[MuteManager] Failed to send ${type} embed after ${maxAttempts} attempts:`, error);
            throw error;
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }

    } catch (error) {
      console.error(`[MuteManager] Error sending ${type} embed:`, error);
    }
  }

  
  public static getStats(): MuteManagerStats {
    return { ...MuteManager.getInstance().stats };
  }

  public static getPendingOperations(): MuteOperation[] {
    return Array.from(MuteManager.getInstance().pendingOperations.values());
  }

  public static async getMuteInfo(targetId: string): Promise<{
    isMuted: boolean;
    muteCount: number;
    lastMute?: any;
    timeRemaining?: number;
  } | null> {
    try {
      const user = await User.findOne({ discordId: targetId }).select('ismuted mutes').lean();
      if (!user) return null;

      const result = {
        isMuted: user.ismuted || false,
        muteCount: user.mutes?.length || 0,
        lastMute: undefined as any,
        timeRemaining: undefined as number | undefined
      };

      if (user.mutes && user.mutes.length > 0) {
        const lastMute = user.mutes[user.mutes.length - 1];
        result.lastMute = lastMute;

        if (lastMute.duration > 0) {
          const muteExpiry = new Date(lastMute.date.getTime() + lastMute.duration * 60000);
          const remaining = muteExpiry.getTime() - Date.now();
          result.timeRemaining = Math.max(0, remaining);
        }
      }

      return result;
    } catch (error) {
      console.error(`[MuteManager] Error getting mute info for ${targetId}:`, error);
      return null;
    }
  }

  public static cleanup(): void {
    const instance = MuteManager.getInstance();
    
    if (instance.autoUnmuteInterval) {
      clearInterval(instance.autoUnmuteInterval);
      instance.autoUnmuteInterval = null;
    }
    
    instance.pendingOperations.clear();
    console.log('[MuteManager] Cleanup completed');
  }
}