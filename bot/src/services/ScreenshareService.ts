import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Guild, GuildMember, TextChannel } from 'discord.js';
import { SCREENSHARE_OFF_MESSAGE, ScreenshareSwitch } from './ScreenshareSwitch';
import ScreenshareSession, { IScreenshareSession } from '../models/ScreenshareSession';
import User from '../models/User';
import config from '../config/config';
import { randomUUID } from 'crypto';
import { embedsFor } from '../utils/betterembed';
import { deleteChannelIfEmpty } from '../utils/channelCleanup';
import { isTargetThreadAccess, screenshareThreadPing, TARGET_THREAD_ACCESS } from './screenshareAccess';
import { ScreenshareCloseResult, ScreenshareCreateOptions, ScreenshareFreezeResult, ScreensharePermissionCheck, ScreensharePostOptions, ScreensharePostResult, ScreenshareSessionResult, ScreenshareTakeResult, ScreenshareValidationResult } from '../types/screenshare';
import { recordAudit } from './AuditService';

const { themedEmbed } = embedsFor('Screenshare');

export class ScreenshareService {
  static readonly SESSION_TIMEOUT = 15 * 60 * 1000;
  static readonly FREEZE_TIMEOUT = 10 * 60 * 1000;
  static readonly TAKEN_TIMEOUT = 105 * 60 * 1000;
  static readonly GAME_END_TIMEOUT = 10 * 60 * 1000;
  static readonly GAME_WAIT_LIMIT = 2 * 60 * 60 * 1000;
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
    if (!config.channels.screensharerequestsChannel) {
      return { isValid: false, error: 'Screenshare requests channel not configured' };
    }

    if (!config.roles.screensharer) {
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
      const waitingForGame = fromGame && options.untilGameEnd === true;
      const expireTime = new Date(Date.now() + (waitingForGame ? this.GAME_WAIT_LIMIT : this.SESSION_TIMEOUT));

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
          ...(waitingForGame ? { waitingForGame: true } : {}),
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
        const dontlogUuid = randomUUID();
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

      if (new Date(Date.now()) > session.expireTime) {
        await ScreenshareSession.updateOne(
          { sessionId: session.sessionId, status: 'pending' },
          {
            $set: { status: 'expired' },
            $push: { actions: { action: 'expire', userId: 'system', timestamp: new Date() } }
          }
        );
        return { success: false, error: 'Session has expired' };
      }

      if (moderatorId !== 'system') {
        const permissionCheck = await this.checkScreensharePermissions(guild, moderatorId);
        if (!permissionCheck.hasPermission) {
          return { success: false, error: permissionCheck.error };
        }
      }

      const member: GuildMember | null = guild.members.cache?.get(session.targetId) ?? await guild.members.fetch(session.targetId).catch(() => null);
      if (!member) {
        return { success: false, error: 'Target user not found in server' };
      }

      const frozen = await ScreenshareSession.findOneAndUpdate(
        { sessionId: session.sessionId, status: 'pending' },
        {
          $set: {
            status: 'frozen',
            freezeTime: new Date(Date.now()),
            expireTime: new Date(Date.now() + this.FREEZE_TIMEOUT)
          },
          $unset: { waitingForGame: '' },
          $push: {
            actions: {
              action: 'freeze',
              userId: moderatorId,
              timestamp: new Date(),
              context: moderatorId === 'system' ? 'Frozen when the game ended' : 'Frozen by a screensharer'
            }
          }
        },
        { new: true }
      );
      if (!frozen) {
        return { success: false, error: 'Session is no longer pending' };
      }

      const frozenRoleId = config.roles.frozen;
      if (frozenRoleId) {
        await member.roles.add(frozenRoleId, 'Screenshare session frozen').catch(error => {
          console.warn('[ScreenshareService] Failed to add frozen role:', error);
        });
      }

      const thread = await this.fetchText(guild, frozen.threadId);
      if (thread) {
        const pingTeam = session.waitingForGame === true && !!config.roles.screensharer;
        await thread.send({
          content: `${pingTeam ? `<@&${config.roles.screensharer}> ` : ''}<@${frozen.targetId}>`,
          embeds: [this.createFreezeEmbed(frozen.targetId)],
          allowedMentions: { users: [frozen.targetId], roles: pingTeam ? [config.roles.screensharer] : [] }
        }).catch(error => {
          console.warn(`[ScreenshareService] Could not post the freeze message for ${frozen.sessionId}:`, error);
        });
      }
      await this.refreshTicket(guild, frozen);
      this.registerThread(frozen);

      await recordAudit({
        action: 'screenshare.freeze',
        category: 'screenshare',
        source: moderatorId === 'system' ? 'system' : 'discord',
        success: true,
        actorId: moderatorId,
        guildId: guild.id,
        targetType: 'user',
        targetId: frozen.targetId,
        targetName: frozen.targetIgn,
        metadata: { sessionId: frozen.sessionId, threadId: frozen.threadId },
      });
      return { success: true, session: frozen };
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

  static async startAfterGame(guild: Guild, targetIgns: string[]): Promise<number> {
    const igns = targetIgns.filter(ign => typeof ign === 'string' && ign.length > 0);
    if (igns.length === 0) return 0;
    try {
      const sessions = await ScreenshareSession.find({
        status: 'pending',
        waitingForGame: true,
        targetIgn: { $in: igns }
      }).collation({ locale: 'en', strength: 2 });

      let started = 0;
      for (const session of sessions) {
        const result = await this.freezeSession(guild, session, 'system');
        if (result.success) {
          started++;
        } else {
          console.warn(`[ScreenshareService] Could not freeze ${session.targetIgn} after the game: ${result.error}`);
        }
      }
      return started;
    } catch (error) {
      console.error('[ScreenshareService] Error freezing players after the game:', error);
      return 0;
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

  static async getSessionByChannelId(channelId: string, channelName?: string): Promise<IScreenshareSession | null> {
    try {
      const found = await ScreenshareSession.findOne({ $or: [{ channelId }, { threadId: channelId }] });
      if (found) return found;
      const fromName = channelName?.match(/\|\s*(SS[A-Z0-9]+)\s*$/)?.[1];
      return fromName ? await ScreenshareSession.findOne({ sessionId: fromName }) : null;
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
        `-# The ticket closes in ${this.FREEZE_TIMEOUT / 60000} minutes unless a screensharer claims it.`
      );
  }

  static ticketStatus(session: Pick<IScreenshareSession, 'status' | 'takenBy'>): string {
    if (session.status === 'frozen') return session.takenBy ? 'ACTIVE' : 'FROZEN';
    return session.status.toUpperCase();
  }

  static ticketOutcome(session: Pick<IScreenshareSession, 'status' | 'actions'>): string | null {
    if (session.status === 'expired') return 'Session expired automatically';
    if (session.status !== 'closed' && session.status !== 'cancelled') return null;
    const last = [...(session.actions ?? [])].reverse().find(a => a.action === 'close' || a.action === 'cancel');
    if (!last) return 'Closed';
    const by = last.userId && last.userId !== 'system' ? `\nClosed by <@${last.userId}>` : '';
    return `${last.context || 'Closed'}${by}`;
  }

  static createRequestEmbed(session: IScreenshareSession): EmbedBuilder {
    const status = this.ticketStatus(session);
    const open = status === 'PENDING' || status === 'FROZEN' || status === 'ACTIVE';
    const embed = themedEmbed(open ? 'warning' : 'info')
      .setTitle('Screenshare Request')
      .setDescription(`<@${session.targetId}> has been requested to screenshare.`)
      .addFields({ name: 'Status', value: `\`${status}\`` });
    const outcome = this.ticketOutcome(session);
    if (outcome) embed.addFields({ name: 'Outcome', value: outcome });
    if (session.threadId) embed.addFields({ name: 'Channel', value: `<#${session.threadId}>` });
    return embed.setTimestamp(new Date(Date.now()));
  }

  static createSessionEmbed(session: IScreenshareSession, imageUrl?: string): EmbedBuilder {
    const status = this.ticketStatus(session);
    const active = status === 'ACTIVE';
    const open = status === 'PENDING' || status === 'FROZEN' || active;
    const expires = session.waitingForGame && status === 'PENDING'
      ? 'When the game ends, the player is frozen'
      : open ? `<t:${Math.floor(session.expireTime.getTime() / 1000)}:R>` : 'Ended';
    const embed = themedEmbed(active ? 'success' : open ? 'warning' : 'info')
      .setTitle(active ? 'Screenshare Active Session' : 'Screenshare Session')
      .setDescription(active ? 'This request is now actively being screenshared.' : 'Use the buttons below to manage this screenshare request.')
      .addFields(
        { name: 'Status', value: `\`${status}\`` },
        { name: 'Target', value: `<@${session.targetId}>` },
        { name: 'Requester', value: `<@${session.requesterId}>` }
      );
    if (session.takenBy) embed.addFields({ name: 'Claimed By', value: `<@${session.takenBy}>` });
    embed.addFields(
      { name: 'Expires', value: expires },
      { name: 'Reason', value: session.reason || 'No reason given' }
    );
    const outcome = this.ticketOutcome(session);
    if (outcome) embed.addFields({ name: 'Outcome', value: outcome });
    if (session.playerNote) embed.addFields({ name: 'Player', value: session.playerNote });
    const image = imageUrl ?? session.imageUrl;
    if (image) embed.setImage(image);
    return embed.setFooter({ text: `Session ID: ${session.sessionId}` });
  }

  static ticketButtons(session: IScreenshareSession): ActionRowBuilder<ButtonBuilder>[] {
    const status = this.ticketStatus(session);
    if (status === 'PENDING') {
      return [this.createFreezeButton(session.sessionId, !session.waitingForGame)];
    }
    if (status === 'FROZEN') {
      return [this.createClaimButton(session.sessionId)];
    }
    return [];
  }

  static createClaimButton(sessionId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ss_claim_${sessionId}`)
        .setLabel('Claim')
        .setStyle(ButtonStyle.Success)
    );
  }

  static createClaimedMessage(screensharerId: string, targetId: string, expireTime: Date): string {
    const closes = Math.floor(expireTime.getTime() / 1000);
    return `<@${screensharerId}> claimed this screenshare. <@${targetId}>, follow their instructions.\n` +
      `-# The ticket closes <t:${closes}:R> unless it's closed earlier with /ssclose.`;
  }

  static async claimSession(guild: Guild, sessionId: string, screensharerId: string): Promise<ScreenshareTakeResult> {
    try {
      const permissionCheck = await this.checkScreensharePermissions(guild, screensharerId);
      if (!permissionCheck.hasPermission) {
        return { success: false, error: permissionCheck.error };
      }

      const now = new Date(Date.now());
      const expireTime = new Date(now.getTime() + this.TAKEN_TIMEOUT);
      const claimed = await ScreenshareSession.findOneAndUpdate(
        { sessionId, status: 'frozen', takenBy: { $exists: false }, expireTime: { $gt: now } },
        {
          $set: { takenBy: screensharerId, takenTime: now, expireTime },
          $push: { actions: { action: 'take', userId: screensharerId, timestamp: now, context: 'Screenshare claimed' } }
        },
        { new: true }
      );
      if (!claimed) {
        const existing = await ScreenshareSession.findOne({ sessionId });
        if (!existing) return { success: false, error: 'Session not found' };
        if (existing.takenBy) return { success: false, error: `<@${existing.takenBy}> already claimed this screenshare` };
        if (existing.status === 'pending') return { success: false, error: 'Freeze the player before claiming' };
        if (existing.status !== 'frozen') return { success: false, error: `This screenshare session is ${existing.status}` };
        return { success: false, error: 'This screenshare session has expired' };
      }

      const thread = await this.fetchText(guild, claimed.threadId);
      if (thread) {
        await thread.send({
          content: this.createClaimedMessage(screensharerId, claimed.targetId, expireTime),
          allowedMentions: { users: [claimed.targetId] }
        }).catch(error => {
          console.warn(`[ScreenshareService] Could not post the claim message for ${sessionId}:`, error);
        });
      }
      await this.refreshTicket(guild, claimed);
      this.registerThread(claimed);

      await recordAudit({
        action: 'screenshare.claim',
        category: 'screenshare',
        source: 'discord',
        success: true,
        actorId: screensharerId,
        guildId: guild.id,
        targetType: 'user',
        targetId: claimed.targetId,
        targetName: claimed.targetIgn,
        metadata: { sessionId, expires: expireTime.toISOString() },
      });
      return { success: true, expireTime };
    } catch (error) {
      console.error('[ScreenshareService] Error claiming session:', error);
      return { success: false, error: 'Failed to claim screenshare session' };
    }
  }

  static async refreshTicket(guild: Guild, session: IScreenshareSession): Promise<void> {
    const edits: Promise<unknown>[] = [];
    const requestsChannel = await this.fetchText(guild, config.channels.screensharerequestsChannel);
    if (requestsChannel && session.requestMessageId) {
      edits.push(requestsChannel.messages.edit(session.requestMessageId, { embeds: [this.createRequestEmbed(session)], components: [] }));
    }
    const thread = await this.fetchText(guild, session.threadId);
    if (thread && session.sessionMessageId) {
      edits.push(thread.messages.edit(session.sessionMessageId, { embeds: [this.createSessionEmbed(session)], components: this.ticketButtons(session) }));
    }
    const results = await Promise.allSettled(edits);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(`[ScreenshareService] Could not update the ticket for ${session.sessionId}:`, result.reason);
      }
    }
  }

  private static async fetchText(guild: Guild, channelId?: string): Promise<TextChannel | null> {
    if (!channelId) return null;
    const channel = guild.channels.cache?.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    return channel && channel.isTextBased() ? channel as unknown as TextChannel : null;
  }

  private static registerThread(session: IScreenshareSession): void {
    const wsManager = global._wsManager;
    if (!session.threadId || !wsManager || typeof wsManager.registerScreenshareThread !== 'function') return;
    try {
      wsManager.registerScreenshareThread({
        ign: session.targetIgn,
        sessionId: session.sessionId,
        threadId: session.threadId,
        expiresAt: session.expireTime.getTime()
      });
    } catch (error) {
      console.warn('[ScreenshareService] Failed to register thread with websocket manager:', error);
    }
  }

  static threadName(ign: string): string {
    const clean = ign.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 32);
    return `ss-${clean || 'player'}`;
  }

  static async postRequest(
    guild: Guild,
    session: IScreenshareSession,
    options: ScreensharePostOptions
  ): Promise<ScreensharePostResult> {
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

    const notes: string[] = [];
    if (options.dontlogResult) {
      notes.push(`Online: ${options.dontlogResult.online ? 'Yes' : 'No'} | DontLog: ${options.dontlogResult.dontlog ? 'Yes' : 'No'}`);
    }
    if (options.loggedOff) {
      notes.push('Left the game after being requested');
    }
    if (notes.length > 0) {
      session.playerNote = notes.join('\n');
    }

    const screensharerRoleId = config.roles.screensharer;
    let threadId: string;
    try {
      const requestMessage = await channel.send({
        content: `<@${session.targetId}>`,
        embeds: [this.createRequestEmbed(session)],
        allowedMentions: { parse: [] }
      });

      const thread = await requestMessage.startThread({
        name: this.threadName(session.targetIgn),
        autoArchiveDuration: 1440,
        reason: `Screenshare session thread for ${session.sessionId}`
      });
      threadId = thread.id;
      session.threadId = threadId;
      session.requestMessageId = requestMessage.id;

      const people = [session.requesterId, session.targetId];
      for (const userId of people) {
        await this.letIntoThread(channel, userId, session.sessionId);
      }
      const sessionMessage = await thread.send({
        ...screenshareThreadPing(session.waitingForGame ? undefined : screensharerRoleId, session.targetId, session.requesterId),
        embeds: [this.createSessionEmbed(session, options.imageUrl)],
        components: this.ticketButtons(session)
      });
      session.sessionMessageId = sessionMessage.id;
      for (const userId of people) {
        await thread.members.add(userId).catch(error => {
          console.warn(`[ScreenshareService] Could not add ${userId} to thread ${thread.id}:`, error);
        });
      }
      if (options.loggedOff) {
        await thread.send(`**${options.targetName}** left the server.`);
      }
      await ScreenshareSession.updateOne(
        { sessionId: session.sessionId },
        { $set: { threadId, requestMessageId: requestMessage.id, sessionMessageId: sessionMessage.id, ...(session.playerNote ? { playerNote: session.playerNote } : {}) } }
      ).catch(error => {
        console.warn(`[ScreenshareService] Could not save the ticket messages for ${session.sessionId}:`, error);
      });
      await requestMessage.edit({ embeds: [this.createRequestEmbed(session)] }).catch(() => undefined);
    } catch (error) {
      console.error('[ScreenshareService] Failed to create request thread:', error);
      return fail('Failed to create screenshare thread.');
    }

    this.registerThread(session);
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

  static createFreezeButton(sessionId: string, withFreeze = true): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();
    if (withFreeze) {
      row.addComponents(new ButtonBuilder()
        .setCustomId(`ss_freeze_${sessionId}`)
        .setLabel('Freeze Player')
        .setStyle(ButtonStyle.Danger));
    }
    return row.addComponents(new ButtonBuilder()
      .setCustomId(`ss_cancel_${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary));
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

  private static generateSessionId(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `SS${timestamp}${random}`;
  }

  private static async finishTicket(guild: Guild, sessionId: string): Promise<void> {
    const ended = await ScreenshareSession.findOne({ sessionId });
    if (!ended) return;
    await this.refreshTicket(guild, ended);
    const thread = await this.fetchText(guild, ended.threadId) as unknown as { setLocked?: (locked: boolean, reason?: string) => Promise<unknown>; setArchived?: (archived: boolean, reason?: string) => Promise<unknown> } | null;
    if (!thread) return;
    const reason = `Screenshare session ${sessionId} ended`;
    await thread.setLocked?.(true, reason).catch(error => {
      console.warn(`[ScreenshareService] Could not lock the thread for ${sessionId}:`, error);
    });
    await thread.setArchived?.(true, reason).catch(error => {
      console.warn(`[ScreenshareService] Could not close the thread for ${sessionId}:`, error);
    });
  }

  private static async cleanupSession(guild: Guild, session: IScreenshareSession): Promise<void> {
    const cleanupTasks: Promise<void>[] = [];

    try {
      cleanupTasks.push(this.finishTicket(guild, session.sessionId).catch(error => {
        console.warn(`[ScreenshareService] Could not finish the ticket for ${session.sessionId}:`, error);
      }));

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