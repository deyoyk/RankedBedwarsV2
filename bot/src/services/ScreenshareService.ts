import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CategoryChannel, EmbedBuilder, Guild, GuildMember, OverwriteResolvable, TextChannel } from 'discord.js';
import { SCREENSHARE_OFF_MESSAGE, ScreenshareSwitch } from './ScreenshareSwitch';
import ScreenshareSession, { IScreenshareSession } from '../models/ScreenshareSession';
import User from '../models/User';
import config from '../config/config';
import { v4 as uuidv4 } from 'uuid';
import { embedsFor } from '../utils/betterembed';
import { deleteChannelIfEmpty } from '../utils/channelCleanup';
import { isTargetThreadAccess, screenshareThreadPing, TARGET_THREAD_ACCESS } from './screenshareAccess';
import { ScreenshareChannelConfig, ScreenshareCloseResult, ScreenshareCreateOptions, ScreenshareFreezeResult, ScreensharePermissionCheck, ScreensharePostOptions, ScreensharePostResult, ScreenshareSessionResult, ScreenshareTakeResult, ScreenshareValidationResult } from '../types/screenshare';
import { recordAudit } from './AuditService';

const { themedEmbed } = embedsFor('Screenshare');

export class ScreenshareService {
  static readonly SESSION_TIMEOUT = 15 * 60 * 1000;
  static readonly FREEZE_TIMEOUT = 10 * 60 * 1000;
  static readonly TAKEN_TIMEOUT = 105 * 60 * 1000;
  private static readonly MAX_ACTIVE_SESSIONS_PER_USER = 1;
  private static readonly MAX_REASON_LENGTH = 500;
  private static readonly MIN_REASON_LENGTH = 10;
  private static readonly EXPIRY_CLEANUP_CONCURRENCY = 5;

  
  static validateScreenshareRequest(targetId: string, requesterId: string, reason: string, imageUrl?: string, fromGame = false): ScreenshareValidationResult {
    
    if (targetId === requesterId) {
      return { isValid: false, error: 'You cannot screenshare yourself' };
    }

    const minReasonLength = fromGame ? 1 : this.MIN_REASON_LENGTH;
    if (!reason || reason.trim().length < minReasonLength) {
      return { isValid: false, error: fromGame ? 'A reason is required' : `Reason must be at least ${this.MIN_REASON_LENGTH} characters long` };
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
      const member = guild.members.cache?.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return { hasPermission: false, error: 'User not found in guild' };
      }

      const screensharerRoleId = config.roles.screensharer;
      if (!screensharerRoleId) {
        return { hasPermission: false, error: 'Screensharer role not configured' };
      }

      if (!member.roles.cache.has(screensharerRoleId)) {
        return { hasPermission: false, error: 'You do not have the screensharer role' };
      }

      return { hasPermission: true };
    } catch (error) {
      console.error('[ScreenshareService] Error checking permissions:', error);
      return { hasPermission: false, error: 'Failed to check permissions' };
    }
  }

  static async checkActiveSessionLimits(targetId: string, requesterId: string, fromGame = false): Promise<ScreenshareValidationResult> {
    try {
      
      const existingTargetSession = await ScreenshareSession.findOne({
        targetId,
        status: { $in: ['pending', 'frozen'] }
      });

      if (existingTargetSession) {
        return { isValid: false, error: 'Target user already has an active screenshare session' };
      }

      // The Minecraft server already limits in-game requests per game and team.
      if (fromGame) {
        return { isValid: true };
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
    imageUrl: string,
    options: ScreenshareCreateOptions = {}
  ): Promise<ScreenshareSessionResult> {
    const fromGame = options.fromGame === true;
    if (!ScreenshareSwitch.current().enabled) {
      return { success: false, error: SCREENSHARE_OFF_MESSAGE };
    }
    try {
      
      const validation = this.validateScreenshareRequest(targetId, requesterId, reason, imageUrl, fromGame);
      if (!validation.isValid) {
        return { success: false, error: validation.error };
      }

      // In-game requesters are ordinary players; the Minecraft server decides who may request.
      if (!fromGame) {
        const permissionCheck = await this.checkScreensharePermissions(guild, requesterId);
        if (!permissionCheck.hasPermission) {
          return { success: false, error: permissionCheck.error };
        }
      }


      const sessionLimitCheck = await this.checkActiveSessionLimits(targetId, requesterId, fromGame);
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

      
      const targetMember = guild.members.cache?.get(targetId) ?? await guild.members.fetch(targetId).catch(() => null);
      if (!targetMember) {
        return { success: false, error: 'Target user not found in server' };
      }

      
      const sessionId = this.generateSessionId();
      const expireTime = new Date(Date.now() + this.SESSION_TIMEOUT);

      let session;
      try {
        session = await ScreenshareSession.create({
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
      } catch (createError) {
        const code = (createError as { code?: unknown })?.code;
        if (code === 11000) {
          return { success: false, error: 'Target user already has an active screenshare session' };
        }
        throw createError;
      }

      
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
      await recordAudit({
        action: 'screenshare.create',
        category: 'screenshare',
        source: fromGame ? 'minecraft' : 'discord',
        success: true,
        actorId: requesterId,
        guildId: guild.id,
        targetType: 'user',
        targetId,
        targetName: targetUser.ign,
        reason: reason.trim(),
        metadata: { sessionId, expires: expireTime.toISOString(), fromGame },
      });
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
        await ScreenshareSession.updateOne(
          { sessionId: session.sessionId, status: 'pending' },
          {
            $set: { status: 'expired' },
            $push: { actions: { action: 'expire', userId: 'system', timestamp: new Date() } }
          }
        );
        return { success: false, error: 'Session has expired' };
      }

      
      const permissionCheck = await this.checkScreensharePermissions(guild, moderatorId);
      if (!permissionCheck.hasPermission) {
        return { success: false, error: permissionCheck.error };
      }

      
      const member: GuildMember | null = guild.members.cache?.get(session.targetId) ?? await guild.members.fetch(session.targetId).catch(() => null);
      if (!member) {
        console.error('[ScreenshareService] Target user not found in server');
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

      
      const frozen = await ScreenshareSession.findOneAndUpdate(
        { sessionId: session.sessionId, status: 'pending' },
        {
          $set: {
            status: 'frozen',
            freezeTime: new Date(),
            channelId: channel.id,
            expireTime: new Date(Date.now() + this.FREEZE_TIMEOUT)
          },
          $push: {
            actions: {
              action: 'freeze',
              userId: moderatorId,
              timestamp: new Date(),
              context: `Frozen by moderator, channel created: ${channel.name}`
            }
          }
        },
        { new: true }
      );

      if (!frozen) {
        await this.cleanupSession(guild, {
          sessionId: session.sessionId,
          targetId: session.targetId,
          targetIgn: session.targetIgn,
          channelId: channel.id
        } as IScreenshareSession);
        return { success: false, error: 'Session is no longer pending' };
      }

      console.log(`[ScreenshareService] Frozen session ${session.sessionId}, created channel ${channel.name}`);
      await recordAudit({
        action: 'screenshare.freeze',
        category: 'screenshare',
        source: 'discord',
        success: true,
        actorId: moderatorId,
        guildId: guild.id,
        targetType: 'user',
        targetId: session.targetId,
        targetName: session.targetIgn,
        metadata: { sessionId: session.sessionId, channelId: channel.id },
      });
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
      const closed = await ScreenshareSession.findOneAndUpdate(
        { sessionId, status: { $nin: ['closed', 'expired'] } },
        {
          $set: { status: 'closed' },
          $push: { actions: { action: 'close', userId, timestamp: new Date(), context } }
        },
        { new: true }
      );
      if (!closed) {
        const existing = await ScreenshareSession.findOne({ sessionId });
        if (!existing) {
          return { success: false, error: 'Session not found' };
        }
        return { success: false, error: 'Session already closed or expired' };
      }

      await this.cleanupSession(guild, closed);

      await recordAudit({
        action: 'screenshare.close',
        category: 'screenshare',
        source: userId === 'system' ? 'system' : 'discord',
        success: true,
        actorId: userId,
        guildId: guild.id,
        targetType: 'user',
        targetId: closed.targetId,
        targetName: closed.targetIgn,
        reason: context,
        metadata: { sessionId, status: closed.status },
      });

      return { success: true };
    } catch (error) {
      console.error('[ScreenshareService] Error closing session:', error);
      return { success: false, error: 'Failed to close session' };
    }
  }

  static async expireSessions(guild: Guild): Promise<number> {
    try {
      const now = new Date();
      const sessions = await ScreenshareSession.find({
        status: { $in: ['pending', 'frozen'] },
        expireTime: { $lte: now }
      }).select('sessionId targetId targetIgn requesterId channelId').lean();

      if (sessions.length === 0) return 0;

      const expireAction = {
        action: 'expire' as const,
        userId: 'system',
        timestamp: now
      };
      await ScreenshareSession.bulkWrite(sessions.map((session) => ({
        updateOne: {
          filter: { sessionId: session.sessionId, status: { $in: ['pending', 'frozen'] } },
          update: { $set: { status: 'expired' }, $push: { actions: expireAction } }
        }
      })));

      for (let i = 0; i < sessions.length; i += ScreenshareService.EXPIRY_CLEANUP_CONCURRENCY) {
        const chunk = sessions.slice(i, i + ScreenshareService.EXPIRY_CLEANUP_CONCURRENCY);
        await Promise.allSettled(chunk.map((session) =>
          ScreenshareService.cleanupSession(guild, session as unknown as IScreenshareSession)
        ));
      }

      console.log(`[ScreenshareService] Expired ${sessions.length} screenshare sessions`);
      await Promise.allSettled(sessions.map(session => recordAudit({
        action: 'screenshare.expire',
        category: 'screenshare',
        source: 'system',
        success: true,
        actorId: 'system',
        guildId: guild.id,
        targetType: 'user',
        targetId: session.targetId,
        targetName: session.targetIgn,
        reason: 'Screenshare session expired',
        metadata: { sessionId: session.sessionId },
      })));
      return sessions.length;
    } catch (error) {
      console.error('[ScreenshareService] Error expiring sessions:', error);
      return 0;
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

  static createFreezeEmbed(_targetId: string): EmbedBuilder {
    return themedEmbed('error')
      .setTitle('Screenshare Freeze')
      .setDescription(
        `You have ${this.FREEZE_TIMEOUT / 60000} minutes to download AnyDesk and follow the instructions below.\n\n` +
        `- Do not log out of the server.\n` +
        `- Do not unplug or plug in any devices.\n` +
        `- Do not delete, rename, or modify any files.\n` +
        `- Refusing screenshare results in a 14 day ban.\n` +
        `- Admitting to cheating results in a 14 day ban.\n` +
        `- If broken rules are found during screenshare, you will be punished.\n\n` +
        `**AnyDesk:** https://anydesk.com/en\n\n` +
        `-# The ticket closes in ${this.FREEZE_TIMEOUT / 60000} minutes unless a screensharer takes it.`
      );
  }

  static createTakeButton(sessionId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ss_take_${sessionId}`)
        .setLabel('Take screenshare')
        .setStyle(ButtonStyle.Success)
    );
  }

  static createTakenEmbed(session: IScreenshareSession, screensharerId: string, expireTime: Date): EmbedBuilder {
    const closes = Math.floor(expireTime.getTime() / 1000);
    return themedEmbed('success')
      .setTitle('Screenshare Taken')
      .setDescription(
        `<@${screensharerId}> is screensharing <@${session.targetId}>.\n` +
        `**Ticket closes:** <t:${closes}:R> (<t:${closes}:t>)\n\n` +
        `-# Close it earlier with /ssclose when the screenshare is done.`
      );
  }

  static async takeSession(guild: Guild, sessionId: string, screensharerId: string): Promise<ScreenshareTakeResult> {
    try {
      const permissionCheck = await this.checkScreensharePermissions(guild, screensharerId);
      if (!permissionCheck.hasPermission) {
        return { success: false, error: permissionCheck.error };
      }

      const now = new Date(Date.now());
      const expireTime = new Date(now.getTime() + this.TAKEN_TIMEOUT);
      const taken = await ScreenshareSession.findOneAndUpdate(
        { sessionId, status: 'frozen', takenBy: { $exists: false }, expireTime: { $gt: now } },
        {
          $set: { takenBy: screensharerId, takenTime: now, expireTime },
          $push: { actions: { action: 'take', userId: screensharerId, timestamp: now, context: 'Screenshare taken' } }
        },
        { new: true }
      );
      if (!taken) {
        const existing = await ScreenshareSession.findOne({ sessionId });
        if (!existing) return { success: false, error: 'Session not found' };
        if (existing.takenBy) return { success: false, error: `<@${existing.takenBy}> already took this screenshare` };
        if (existing.status !== 'frozen') return { success: false, error: `This screenshare session is ${existing.status}` };
        return { success: false, error: 'This screenshare session has expired' };
      }

      await recordAudit({
        action: 'screenshare.take',
        category: 'screenshare',
        source: 'discord',
        success: true,
        actorId: screensharerId,
        guildId: guild.id,
        targetType: 'user',
        targetId: taken.targetId,
        targetName: taken.targetIgn,
        metadata: { sessionId, expires: expireTime.toISOString() },
      });
      return { success: true, expireTime };
    } catch (error) {
      console.error('[ScreenshareService] Error taking session:', error);
      return { success: false, error: 'Failed to take screenshare session' };
    }
  }

  static createSessionEmbed(session: IScreenshareSession, imageUrl?: string): EmbedBuilder {
    const embed = themedEmbed('info')
      .setTitle('Screenshare Request')
      .setDescription(
        `A screenshare request has been created.\n\n` +
        `**Target:** <@${session.targetId}>\n` +
        `**Requester:** <@${session.requesterId}>\n` +
        `**Reason:** ${session.reason}\n` +
        `**Expires:** ${this.SESSION_TIMEOUT / 60000} minutes`
      );
    if (imageUrl) {
      embed.setImage(imageUrl);
    }
    return embed;
  }

  static async postRequest(
    guild: Guild,
    session: IScreenshareSession,
    options: ScreensharePostOptions
  ): Promise<ScreensharePostResult> {
    // An unposted session is invisible to screensharers but still blocks new requests for the target.
    const fail = async (error: string): Promise<ScreensharePostResult> => {
      await this.closeSession(guild, session.sessionId, 'system', error);
      return { success: false, error };
    };

    const channelId = config.channels.screensharerequestsChannel;
    if (!channelId) {
      return fail('Screenshare requests channel not configured.');
    }

    let channel: TextChannel;
    try {
      const channelRaw = guild.channels.cache?.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
      if (!channelRaw || !channelRaw.isTextBased()) {
        return fail('Screenshare requests channel not found or not a text channel.');
      }
      channel = channelRaw as TextChannel;
    } catch (error) {
      console.error('[ScreenshareService] Failed to fetch requests channel:', error);
      return fail('Failed to access screenshare requests channel.');
    }

    const embed = this.createSessionEmbed(session, options.imageUrl);
    const row = this.createFreezeButton(session.sessionId);

    if (options.dontlogResult) {
      embed.addFields({
        name: 'Player Status',
        value: `Online: ${options.dontlogResult.online ? 'Yes' : 'No'} | DontLog: ${options.dontlogResult.dontlog ? 'Yes' : 'No'}`,
        inline: true
      });
    }

    if (options.loggedOff) {
      embed.addFields({ name: 'Logged off', value: 'Yes — left the game after being requested', inline: true });
    }

    const screensharerRoleId = config.roles.screensharer;
    const mention = screensharerRoleId ? `<@&${screensharerRoleId}>` : '';

    let threadId: string;
    try {
      const sentMsg = await channel.send({
        content: mention,
        embeds: [embed],
        components: [row]
      });

      const thread = await sentMsg.startThread({
        name: `SS: ${options.targetName} | ${session.sessionId}`,
        autoArchiveDuration: 60,
        reason: `Screenshare session thread for ${session.sessionId}`
      });

      if (screensharerRoleId) {
        await thread.setLocked(false);
      }

      const people = [session.requesterId, session.targetId];
      for (const userId of people) {
        await this.letIntoThread(channel, userId, session.sessionId);
      }
      await thread.send({ ...screenshareThreadPing(screensharerRoleId, session.targetId, session.requesterId), embeds: [embed] });
      for (const userId of people) {
        await thread.members.add(userId).catch(error => {
          console.warn(`[ScreenshareService] Could not add ${userId} to thread ${thread.id}:`, error);
        });
      }
      // The server's "left" update came before this thread existed, so it couldn't be posted here.
      if (options.loggedOff) {
        await thread.send(`**${options.targetName}** left the server.`);
      }
      threadId = thread.id;
    } catch (error) {
      console.error('[ScreenshareService] Failed to create request thread:', error);
      return fail('Failed to create screenshare thread.');
    }

    const wsManager = global._wsManager;
    if (wsManager && typeof wsManager.registerScreenshareThread === 'function') {
      try {
        wsManager.registerScreenshareThread({
          ign: session.targetIgn,
          sessionId: session.sessionId,
          threadId,
          expiresAt: session.expireTime.getTime()
        });
      } catch (error) {
        console.warn('[ScreenshareService] Failed to register thread with websocket manager:', error);
      }
    }

    return { success: true, threadId };
  }

  // Discord only adds people to a thread if they can see its parent channel, and the requests channel is staff-only.
  private static async letIntoThread(channel: TextChannel, userId: string, sessionId: string): Promise<void> {
    if (channel.permissionsFor(userId)?.has('ViewChannel')) return;
    try {
      await channel.permissionOverwrites.edit(userId, TARGET_THREAD_ACCESS, {
        reason: `Screenshare ${sessionId}: let them into the thread`
      });
    } catch (error) {
      console.warn(`[ScreenshareService] Could not give ${userId} access to the requests channel:`, error);
    }
  }

  private static async removeTargetAccess(guild: Guild, session: IScreenshareSession): Promise<void> {
    const channelId = config.channels.screensharerequestsChannel;
    if (!channelId) return;
    const channel = guild.channels.cache?.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !('permissionOverwrites' in channel)) return;
    for (const userId of [session.targetId, session.requesterId]) {
      if (!userId) continue;
      const overwrite = channel.permissionOverwrites.cache.get(userId);
      if (!overwrite || !isTargetThreadAccess(overwrite.allow.bitfield, overwrite.deny.bitfield)) continue;
      const stillOpen = await ScreenshareSession.countDocuments({
        sessionId: { $ne: session.sessionId },
        status: { $in: ['pending', 'frozen'] },
        $or: [{ targetId: userId }, { requesterId: userId }]
      });
      if (stillOpen > 0) continue;
      await channel.permissionOverwrites.delete(userId, `Screenshare ${session.sessionId} ended`);
    }
  }

  static createFreezeButton(sessionId: string): ActionRowBuilder<ButtonBuilder> {
    const freezeBtn = new ButtonBuilder()
      .setCustomId(`ss_freeze_${sessionId}`)
      .setLabel('Freeze Player')
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`ss_cancel_${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder<ButtonBuilder>().addComponents(freezeBtn, cancelBtn);
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
          const category = guild.channels.cache.get(channelConfig.categoryId) ?? await guild.channels.fetch(channelConfig.categoryId);
          if (category && category.type === 4) { 
            categoryChannel = category as CategoryChannel;
          }
        } catch {
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
              const result = await deleteChannelIfEmpty(
                guild,
                session.channelId!,
                `Screenshare session ${session.sessionId} ended`
              );
              if (result === 'deleted') {
                console.log(`[ScreenshareService] Deleted channel for session ${session.sessionId}`);
              } else if (result === 'occupied') {
                console.log(`[ScreenshareService] Channel for session ${session.sessionId} is still occupied; keeping it`);
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
              const member = guild.members.cache.get(session.targetId) ?? await guild.members.fetch(session.targetId).catch(() => null);
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

      
      cleanupTasks.push(
        this.removeTargetAccess(guild, session).catch(error => {
          console.warn(`[ScreenshareService] Failed to remove requests channel access for session ${session.sessionId}:`, error);
        })
      );

      const wsManager = global._wsManager;
      if (session.targetIgn && wsManager && typeof wsManager.unregisterScreenshareThread === 'function') {
        cleanupTasks.push(
          (async () => {
            try {
              wsManager.unregisterScreenshareThread(session.targetIgn);
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