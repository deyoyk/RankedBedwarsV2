import { Guild, GuildMember, TextChannel, CategoryChannel, OverwriteResolvable, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import ScreenshareSession, { IScreenshareSession } from '../models/ScreenshareSession';
import User from '../models/User';
import config from '../config/config';
import { v4 as uuidv4 } from 'uuid';
import { 
  ScreenshareSessionResult, 
  ScreenshareFreezeResult, 
  ScreenshareCloseResult,
  ScreenshareValidationResult,
  ScreensharePermissionCheck,
  ScreenshareChannelConfig
} from '../types/screenshare';

export class ScreenshareService {
  private static readonly SESSION_TIMEOUT = 15 * 60 * 1000; 
  private static readonly FREEZE_TIMEOUT = 5 * 60 * 1000; 
  private static readonly MAX_ACTIVE_SESSIONS_PER_USER = 1;
  private static readonly MAX_REASON_LENGTH = 500;
  private static readonly MIN_REASON_LENGTH = 10;

  
  static validateScreenshareRequest(targetId: string, requesterId: string, reason: string, imageUrl?: string): ScreenshareValidationResult {
    
    if (targetId === requesterId) {
      return { isValid: false, error: 'You cannot screenshare yourself' };
    }

    
    if (!reason || reason.trim().length < this.MIN_REASON_LENGTH) {
      return { isValid: false, error: `Reason must be at least ${this.MIN_REASON_LENGTH} characters long` };
    }

    if (reason.length > this.MAX_REASON_LENGTH) {
      return { isValid: false, error: `Reason cannot exceed ${this.MAX_REASON_LENGTH} characters` };
    }

    
    if (imageUrl && !this.isValidImageUrl(imageUrl)) {
      return { isValid: false, error: 'Invalid image URL provided' };
    }

    return { isValid: true };
  }

  static async checkScreensharePermissions(guild: Guild, userId: string): Promise<ScreensharePermissionCheck> {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return { hasPermission: false, error: 'User not found in guild' };
      }

      const screensharerRoleId = config.roles.screensharer;
      if (!screensharerRoleId) {
        return { hasPermission: false, error: 'Screensharer role not configured' };
      }


      return { hasPermission: true };
    } catch (error) {
      console.error('[ScreenshareService] Error checking permissions:', error);
      return { hasPermission: false, error: 'Failed to check permissions' };
    }
  }

  static async checkActiveSessionLimits(targetId: string, requesterId: string): Promise<ScreenshareValidationResult> {
    try {
      
      const existingTargetSession = await ScreenshareSession.findOne({
        targetId,
        status: { $in: ['pending', 'frozen'] }
      });

      if (existingTargetSession) {
        return { isValid: false, error: 'Target user already has an active screenshare session' };
      }

      
      const requesterSessions = await ScreenshareSession.countDocuments({
        requesterId,
        status: { $in: ['pending', 'frozen'] }
      });

      if (requesterSessions >= this.MAX_ACTIVE_SESSIONS_PER_USER) {
        return { isValid: false, error: 'You have reached the maximum number of active screenshare sessions' };
      }

      return { isValid: true };
    } catch (error) {
      console.error('[ScreenshareService] Error checking session limits:', error);
      return { isValid: false, error: 'Failed to check session limits' };
    }
  }

  static validateChannelConfiguration(): ScreenshareValidationResult {
    const channelConfig = this.getChannelConfiguration();
    
    if (!channelConfig.requestsChannelId) {
      return { isValid: false, error: 'Screenshare requests channel not configured' };
    }

    if (!channelConfig.screensharerRoleId) {
      return { isValid: false, error: 'Screensharer role not configured' };
    }

    return { isValid: true };
  }

  static async createSession(
    guild: Guild, 
    targetId: string, 
    requesterId: string, 
    reason: string, 
    imageUrl: string
  ): Promise<ScreenshareSessionResult> {
    try {
      
      const validation = this.validateScreenshareRequest(targetId, requesterId, reason, imageUrl);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      
      const permissionCheck = await this.checkScreensharePermissions(guild, requesterId);
      if (!permissionCheck.hasPermission) {
        return { success: false, error: permissionCheck.error };
      }

      
      const sessionLimitCheck = await this.checkActiveSessionLimits(targetId, requesterId);
      if (!sessionLimitCheck.isValid) {
        return { success: false, error: sessionLimitCheck.error };
      }

      
      const channelValidation = this.validateChannelConfiguration();
      if (!channelValidation.isValid) {
        return { success: false, error: channelValidation.error };
      }

      
      const targetUser = await User.findOne({ discordId: targetId });
      if (!targetUser) {
        return { success: false, error: 'Target user not found in database' };
      }

      if (!targetUser.ign) {
        return { success: false, error: 'Target user has no IGN set' };
      }

      
      const targetMember = await guild.members.fetch(targetId).catch(() => null);
      if (!targetMember) {
        return { success: false, error: 'Target user not found in server' };
      }

      
      const sessionId = this.generateSessionId();
      const expireTime = new Date(Date.now() + this.SESSION_TIMEOUT);

      const session = await ScreenshareSession.create({
        sessionId,
        targetId,
        targetIgn: targetUser.ign,
        requesterId,
        reason: reason.trim(),
        imageUrl,
        status: 'pending',
        expireTime,
        actions: [{
          action: 'freeze',
          userId: requesterId,
          timestamp: new Date(),
          context: 'Session created'
        }]
      });

      
      let dontlogResult = { online: false, dontlog: false };
      if (global._wsManager && typeof global._wsManager.requestDontLog === 'function') {
        const dontlogUuid = uuidv4();
        try {
          const dontlogPromise = global._wsManager.requestDontLog(targetUser.ign, dontlogUuid);
          const timeoutPromise = new Promise<{ online: boolean; dontlog: boolean }>((_, reject) => 
            setTimeout(() => reject(new Error('Dontlog request timeout')), 5000)
          );
          
          dontlogResult = await Promise.race([dontlogPromise, timeoutPromise]);
        } catch (error) {
          console.warn('[ScreenshareService] Failed to request dontlog:', error);
          
        }
      }

      console.log(`[ScreenshareService] Created session ${sessionId} for ${targetUser.ign} by ${requesterId}`);
      return { success: true, session, dontlogResult };
    } catch (error) {
      console.error('[ScreenshareService] Error creating session:', error);
      return { success: false, error: 'Failed to create screenshare session' };
    }
  }

  static async freezeSession(
    guild: Guild, 
    session: IScreenshareSession, 
    moderatorId: string
  ): Promise<ScreenshareFreezeResult> {
    try {
      
      if (session.status !== 'pending') {
        return { success: false, error: `Session is ${session.status}, cannot freeze` };
      }

      
      if (new Date() > session.expireTime) {
        session.status = 'expired';
        await session.save();
        return { success: false, error: 'Session has expired' };
      }

      
      const permissionCheck = await this.checkScreensharePermissions(guild, moderatorId);
      if (!permissionCheck.hasPermission) {
        return { success: false, error: permissionCheck.error };
      }

      
      let member: GuildMember | null = null;
      for (let i = 0; i < 3; i++) {
        try {
          member = await guild.members.fetch(session.targetId);
          break;
        } catch (error) {
          if (i === 2) {
            console.error('[ScreenshareService] Failed to fetch member after 3 attempts:', error);
            return { success: false, error: 'Target user not found in server' };
          }
          await new Promise(resolve => setTimeout(resolve, 1000)); 
        }
      }

      if (!member) {
        return { success: false, error: 'Target user not found in server' };
      }

      
      const channel = await this.createScreenshareChannel(guild, session);
      if (!channel) {
        return { success: false, error: 'Failed to create screenshare channel' };
      }

      
      const frozenRoleId = config.roles.frozen;
      if (frozenRoleId) {
        try {
          await member.roles.add(frozenRoleId, 'Screenshare session frozen');
          console.log(`[ScreenshareService] Added frozen role to ${member.user.tag}`);
        } catch (error) {
          console.warn('[ScreenshareService] Failed to add frozen role:', error);
          
        }
      }

      
      session.status = 'frozen';
      session.freezeTime = new Date();
      session.channelId = channel.id;
      session.expireTime = new Date(Date.now() + this.FREEZE_TIMEOUT); 
      session.actions.push({
        action: 'freeze',
        userId: moderatorId,
        timestamp: new Date(),
        context: `Frozen by moderator, channel created: ${channel.name}`
      });

      await session.save();

      console.log(`[ScreenshareService] Frozen session ${session.sessionId}, created channel ${channel.name}`);
      return { success: true, channel };
    } catch (error) {
      console.error('[ScreenshareService] Error freezing session:', error);
      return { success: false, error: 'Failed to freeze session' };
    }
  }

  static async closeSession(
    guild: Guild, 
    sessionId: string, 
    userId: string, 
    context?: string
  ): Promise<ScreenshareCloseResult> {
    try {
      const session = await ScreenshareSession.findOne({ sessionId });
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      if (session.status === 'closed' || session.status === 'expired') {
        return { success: false, error: 'Session already closed or expired' };
      }

      session.status = 'closed';
      session.actions.push({
        action: 'close',
        userId,
        timestamp: new Date(),
        context
      });

      await session.save();

      await this.cleanupSession(guild, session);

      return { success: true };
    } catch (error) {
      console.error('[ScreenshareService] Error closing session:', error);
      return { success: false, error: 'Failed to close session' };
    }
  }

  static async expireSessions(guild: Guild): Promise<void> {
    try {
      const now = new Date();
      const sessions = await ScreenshareSession.find({
        status: { $in: ['pending', 'frozen'] },
        expireTime: { $lte: now }
      });

      for (const session of sessions) {
        session.status = 'expired';
        session.actions.push({
          action: 'expire',
          userId: 'system',
          timestamp: now
        });

        await session.save();
        await this.cleanupSession(guild, session);
      }

      if (sessions.length > 0) {
        console.log(`[ScreenshareService] Expired ${sessions.length} screenshare sessions`);
      }
    } catch (error) {
      console.error('[ScreenshareService] Error expiring sessions:', error);
    }
  }

  static async getSessionByChannelId(channelId: string): Promise<IScreenshareSession | null> {
    try {
      return await ScreenshareSession.findOne({ channelId });
    } catch (error) {
      console.error('[ScreenshareService] Error getting session by channel ID:', error);
      return null;
    }
  }

  static async getSessionById(sessionId: string): Promise<IScreenshareSession | null> {
    try {
      return await ScreenshareSession.findOne({ sessionId });
    } catch (error) {
      console.error('[ScreenshareService] Error getting session by ID:', error);
      return null;
    }
  }

  static async getActiveSessions(): Promise<IScreenshareSession[]> {
    try {
      return await ScreenshareSession.find({
        status: { $in: ['pending', 'frozen'] }
      }).sort({ createdAt: -1 });
    } catch (error) {
      console.error('[ScreenshareService] Error getting active sessions:', error);
      return [];
    }
  }

  static createFreezeEmbed(targetId: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('YOU ARE FROZEN YOU HAVE 5 MINUTES TO DOWNLOAD ANYDESK')
      .setDescription(
        `> **What Should You Do ?**\n\n` +
        `> #1 Don't Log Out the Server\n` +
        `> #2 Don't Unplug or plug any devices such as mouses/keyboards/usbs/etc..\n` +
        `> #3 Don't Delete Rename Or Modify any file in your PC\n\n` +
        `> Refuse to SS ***14d Ban***\n` +
        `> Admit to cheating ***14d Ban***\n` +
        `> Get ScreenShared ***if broken rules found you will be punished***\n` +
        `> AnyDesk | https://anydesk.com/en`
      )
      .setTimestamp();
  }

  static createSessionEmbed(session: IScreenshareSession, imageUrl: string): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Screenshare Request')
      .setDescription(
        `**Target:** <@${session.targetId}>\n` +
        `**Requester:** <@${session.requesterId}>\n` +
        `**Reason:** ${session.reason}`
      )
      .setImage(imageUrl)
      .setFooter({ text: `Expires in 15 minutes` })
      .setTimestamp();
  }

  static createFreezeButton(sessionId: string): ActionRowBuilder<ButtonBuilder> {
    const freezeBtn = new ButtonBuilder()
      .setCustomId(`ss_freeze_${sessionId}`)
      .setLabel('Freeze Player')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❄️');

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`ss_cancel_${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌');

    return new ActionRowBuilder<ButtonBuilder>().addComponents(freezeBtn, cancelBtn);
  }

  static async cancelSession(
    guild: Guild, 
    sessionId: string, 
    userId: string, 
    reason?: string
  ): Promise<ScreenshareCloseResult> {
    try {
      const session = await ScreenshareSession.findOne({ sessionId });
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      if (session.status !== 'pending') {
        return { success: false, error: 'Only pending sessions can be cancelled' };
      }

      
      const isRequester = session.requesterId === userId;
      const permissionCheck = await this.checkScreensharePermissions(guild, userId);
      
      if (!isRequester && !permissionCheck.hasPermission) {
        return { success: false, error: 'You do not have permission to cancel this session' };
      }

      session.status = 'cancelled';
      session.actions.push({
        action: 'cancel',
        userId,
        timestamp: new Date(),
        context: reason || 'Session cancelled'
      });

      await session.save();

      
      if (session.targetIgn && global._wsManager && typeof global._wsManager.unregisterScreenshareThread === 'function') {
        try {
          global._wsManager.unregisterScreenshareThread(session.targetIgn);
        } catch (error) {
          console.warn('[ScreenshareService] Failed to unregister websocket thread:', error);
        }
      }

      console.log(`[ScreenshareService] Cancelled session ${sessionId} by ${userId}`);
      return { success: true };
    } catch (error) {
      console.error('[ScreenshareService] Error cancelling session:', error);
      return { success: false, error: 'Failed to cancel session' };
    }
  }

  static async getSessionStats(): Promise<{
    total: number;
    pending: number;
    frozen: number;
    closed: number;
    expired: number;
    cancelled: number;
  }> {
    try {
      const [total, pending, frozen, closed, expired, cancelled] = await Promise.all([
        ScreenshareSession.countDocuments(),
        ScreenshareSession.countDocuments({ status: 'pending' }),
        ScreenshareSession.countDocuments({ status: 'frozen' }),
        ScreenshareSession.countDocuments({ status: 'closed' }),
        ScreenshareSession.countDocuments({ status: 'expired' }),
        ScreenshareSession.countDocuments({ status: 'cancelled' })
      ]);

      return { total, pending, frozen, closed, expired, cancelled };
    } catch (error) {
      console.error('[ScreenshareService] Error getting session stats:', error);
      return { total: 0, pending: 0, frozen: 0, closed: 0, expired: 0, cancelled: 0 };
    }
  }

  
  private static isValidImageUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return ['http:', 'https:'].includes(parsedUrl.protocol) && 
             /\.(jpg|jpeg|png|gif|webp)$/i.test(parsedUrl.pathname);
    } catch {
      return false;
    }
  }

  private static getChannelConfiguration(): ScreenshareChannelConfig {
    return {
      requestsChannelId: config.channels.screensharerequestsChannel,
      categoryId: config.categories.screenshareCategory,
      screensharerRoleId: config.roles.screensharer,
      frozenRoleId: config.roles.frozen
    };
  }

  private static generateSessionId(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `SS${timestamp}${random}`;
  }

  private static async createScreenshareChannel(guild: Guild, session: IScreenshareSession): Promise<TextChannel | null> {
    try {
      const channelConfig = this.getChannelConfiguration();
      
      
      const sanitizedIgn = session.targetIgn.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20);
      const channelName = `ss-${sanitizedIgn}-${session.sessionId.slice(-4)}`.toLowerCase();
      
      
      const existingChannel = guild.channels.cache.find(ch => ch.name === channelName);
      if (existingChannel) {
        console.warn(`[ScreenshareService] Channel ${channelName} already exists, using unique name`);
        const uniqueName = `${channelName}-${Date.now().toString().slice(-4)}`;
        return this.createChannelWithName(guild, session, uniqueName, channelConfig);
      }

      return this.createChannelWithName(guild, session, channelName, channelConfig);
    } catch (error) {
      console.error('[ScreenshareService] Error creating screenshare channel:', error);
      return null;
    }
  }

  private static async createChannelWithName(
    guild: Guild, 
    session: IScreenshareSession, 
    channelName: string, 
    channelConfig: ScreenshareChannelConfig
  ): Promise<TextChannel | null> {
    try {
      const overwrites: OverwriteResolvable[] = [
        { 
          id: guild.roles.everyone, 
          deny: ['ViewChannel', 'SendMessages'] 
        },
        { 
          id: session.targetId, 
          allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'] 
        }
      ];

      
      if (channelConfig.screensharerRoleId) {
        overwrites.push({
          id: channelConfig.screensharerRoleId,
          allow: [
            'ViewChannel', 
            'SendMessages', 
            'ReadMessageHistory', 
            'ManageMessages', 
            'AttachFiles',
            'EmbedLinks'
          ]
        });
      }

      
      let categoryChannel: CategoryChannel | null = null;
      if (channelConfig.categoryId) {
        try {
          const category = await guild.channels.fetch(channelConfig.categoryId);
          if (category && category.type === 4) { 
            categoryChannel = category as CategoryChannel;
          }
        } catch (error) {
          console.warn('[ScreenshareService] Category not found, creating channel without category');
        }
      }

      const channel = await guild.channels.create({
        name: channelName,
        type: 0, 
        parent: categoryChannel?.id,
        permissionOverwrites: overwrites,
        reason: `Screenshare session for ${session.targetIgn} (${session.sessionId})`,
        topic: `Screenshare session for ${session.targetIgn} | Session ID: ${session.sessionId} | Expires: ${session.expireTime.toISOString()}`
      });

      console.log(`[ScreenshareService] Created channel ${channelName} for session ${session.sessionId}`);
      return channel as TextChannel;
    } catch (error) {
      console.error('[ScreenshareService] Error creating channel with name:', error);
      return null;
    }
  }

  private static async cleanupSession(guild: Guild, session: IScreenshareSession): Promise<void> {
    const cleanupTasks: Promise<void>[] = [];

    try {
      
      if (session.channelId) {
        cleanupTasks.push(
          (async () => {
            try {
              const channel = await guild.channels.fetch(session.channelId!).catch(() => null);
              if (channel) {
                await channel.delete(`Screenshare session ${session.sessionId} ended`);
                console.log(`[ScreenshareService] Deleted channel for session ${session.sessionId}`);
              }
            } catch (error) {
              console.warn(`[ScreenshareService] Failed to delete channel for session ${session.sessionId}:`, error);
            }
          })()
        );
      }

      
      const frozenRoleId = config.roles.frozen;
      if (frozenRoleId) {
        cleanupTasks.push(
          (async () => {
            try {
              const member = await guild.members.fetch(session.targetId).catch(() => null);
              if (member && member.roles.cache.has(frozenRoleId)) {
                await member.roles.remove(frozenRoleId, `Screenshare session ${session.sessionId} ended`);
                console.log(`[ScreenshareService] Removed frozen role from ${member.user.tag}`);
              }
            } catch (error) {
              console.warn(`[ScreenshareService] Failed to remove frozen role for session ${session.sessionId}:`, error);
            }
          })()
        );
      }

      
      if (session.targetIgn && global._wsManager && typeof global._wsManager.unregisterScreenshareThread === 'function') {
        cleanupTasks.push(
          (async () => {
            try {
              global._wsManager.unregisterScreenshareThread(session.targetIgn);
              console.log(`[ScreenshareService] Unregistered websocket thread for ${session.targetIgn}`);
            } catch (error) {
              console.warn(`[ScreenshareService] Failed to unregister websocket thread for ${session.targetIgn}:`, error);
            }
          })()
        );
      }

      
      await Promise.allSettled(cleanupTasks.map(task => 
        Promise.race([
          task,
          new Promise<void>((_, reject) => 
            setTimeout(() => reject(new Error('Cleanup task timeout')), 10000)
          )
        ])
      ));

      console.log(`[ScreenshareService] Completed cleanup for session ${session.sessionId}`);
    } catch (error) {
      console.error('[ScreenshareService] Error during session cleanup:', error);
    }
  }
}