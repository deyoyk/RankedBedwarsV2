import { Client, VoiceState } from 'discord.js';
import type { VoiceBasedChannel } from 'discord.js';
import Queue from '../models/Queue';
import User, { type IUser } from '../models/User';
import Party from '../models/Party';
import Game from '../models/Game';
import config from '../config/config';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { CentralizedMatchmaker } from '../Matchmaking/CentralizedMatchmaker';
import { GameManager } from '../Matchmaking/GameManager';
import { WorkersManager } from '../managers/WorkersManager';
import { queuePlayers } from '../types/queuePlayersMemory';
import { PresenceService } from '../services/PresenceService';

async function updatePartyActivity(partyId: string) {
  try {
    await Party.updateOne(
      { partyId: partyId },
      { lastActiveTime: new Date() }
    );
  } catch (error) {
    console.error('Error updating party activity:', error);
  }
}

interface QueueState {
  players: string[];
  parties: Map<string, string[]>;
  lastUpdate: number;
  processing: boolean;
  lastOfflineVersion?: number;
}

interface QueueLike {
  id?: unknown;
  channelId: string;
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isActive?: boolean;
  isRanked?: boolean;
  isPicking?: boolean;
  queueType?: string;
  bypassRoles: string[];
}

type QueueUserBadge = Pick<IUser, 'discordId' | 'ign' | 'partyId'>;

async function resolveQuery<T>(query: unknown, selectFields?: string): Promise<T> {
  const q = query as {
    select?: (fields: string) => { lean: () => Promise<T> };
    lean?: () => Promise<T>;
  };
  if (selectFields && typeof q.select === 'function') return q.select(selectFields).lean();
  if (typeof q.lean === 'function') return q.lean();
  return q as unknown as Promise<T>;
}

export class QueueListener {
  private client: Client;
  private matchmaker: CentralizedMatchmaker;
  private wsManager: WebSocketManager;
  private workersManager: WorkersManager;
  private partyCache: Map<string, { members: string[], timestamp: number }> = new Map();
  private queueStates: Map<string, QueueState> = new Map();
  private processingLocks: Map<string, NodeJS.Timeout> = new Map();
  private queueChannelCache: Map<string, { exists: boolean; ts: number }> = new Map();
  private rescanKeys: Map<string, { key: string; ts: number }> = new Map();
  private readonly CACHE_TTL = 30000;
  private readonly QUEUE_CHECK_INTERVAL = 5000;
  private readonly CHANNEL_CACHE_TTL = 30000;
  private readonly PRESENCE_SWEEP_INTERVAL = 30000;

  constructor(client: Client, wsManager: WebSocketManager, gameManager: GameManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.workersManager = WorkersManager.getInstance();
    this.matchmaker = new CentralizedMatchmaker(client, wsManager, gameManager);
    this.startCacheCleanup();
    this.startQueueMonitor();
    this.startPresenceSweep();
  }

  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [partyId, data] of this.partyCache.entries()) {
        if (now - data.timestamp > this.CACHE_TTL) {
          this.partyCache.delete(partyId);
        }
      }
      for (const [channelId, data] of this.queueChannelCache.entries()) {
        if (now - data.ts > this.CHANNEL_CACHE_TTL) {
          this.queueChannelCache.delete(channelId);
        }
      }
      for (const [channelId, data] of this.rescanKeys.entries()) {
        if (now - data.ts > 300000) {
          this.rescanKeys.delete(channelId);
        }
      }
    }, 60000);
  }

  private startQueueMonitor(): void {
    setInterval(async () => {
      await this.checkAllQueues();
    }, this.QUEUE_CHECK_INTERVAL);
  }

  private startPresenceSweep(): void {
    setInterval(async () => {
      await this.sweepUnknownPresence().catch((error) => {
        console.error('[QueueListener] Error in presence sweep:', error);
      });
    }, this.PRESENCE_SWEEP_INTERVAL);
  }

  private async sweepUnknownPresence(): Promise<void> {
    if (!PresenceService.isConnected()) return;
    const now = Date.now();
    const entries = [...this.queueStates.entries()];
    for (let i = 0; i < entries.length; i += QueueListener.SWEEP_CONCURRENCY) {
      const chunk = entries.slice(i, i + QueueListener.SWEEP_CONCURRENCY);
      await Promise.allSettled(chunk.map(([queueId, state]) => this.sweepQueuePresence(queueId, state, now)));
    }
  }

  private async sweepQueuePresence(queueId: string, state: QueueState, now: number): Promise<void> {
    if (state.players.length === 0) return;
    let users: QueueUserBadge[];
    try {
      users = await User.find({ discordId: { $in: state.players } }).select('discordId ign').lean();
    } catch (error) {
      console.error(`[QueueListener] Presence sweep lookup failed for ${queueId}:`, error);
      return;
    }
    const unknown: string[] = [];
    for (const user of users) {
      if (user?.ign && PresenceService.evaluate(user.ign, now) === 'unknown') {
        unknown.push(user.ign);
      }
    }
    if (unknown.length > 0) {
      console.log(`[QueueListener] Presence sweep re-checking ${unknown.length} player(s) in queue ${queueId}`);
    }
    for (let j = 0; j < unknown.length; j += 5) {
      const batch = unknown.slice(j, j + 5);
      const results = await Promise.allSettled(batch.map((ign) => this.wsManager.checkPlayerOnline(ign)));
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          PresenceService.ingest(batch[index], result.value.online === true);
        }
      });
    }
  }

  private static readonly QUEUE_TICK_CONCURRENCY = 5;
  private static readonly SWEEP_CONCURRENCY = 5;

  private async checkAllQueues(): Promise<void> {
    try {
      const queues = await resolveQuery<QueueLike[]>(
        Queue.find({ isActive: true }),
        'channelId maxPlayers minElo maxElo isActive isRanked isPicking queueType bypassRoles'
      );

      for (let i = 0; i < queues.length; i += QueueListener.QUEUE_TICK_CONCURRENCY) {
        const chunk = queues.slice(i, i + QueueListener.QUEUE_TICK_CONCURRENCY);
        await Promise.allSettled(chunk.map((queue) => this.validateQueueState(queue.channelId, queue)));
      }
    } catch (error) {
      console.error('[QueueListener] Error in queue monitor:', error);
    }
  }

  private async validateQueueState(queueId: string, preloadedQueue?: QueueLike): Promise<void> {
    try {
      let queue: QueueLike | null = preloadedQueue ?? null;
      if (!queue) {
        queue = await resolveQuery<QueueLike | null>(
          Queue.findOne({ channelId: queueId }),
          'channelId maxPlayers minElo maxElo isRanked isPicking queueType bypassRoles'
        );
      }
      if (!queue) {
        this.queueStates.delete(queueId);
        return;
      }

      const state = this.queueStates.get(queueId);
      if (!state) return;

      const guild = this.client.guilds.cache.first();
      if (!guild) return;

      const voiceChannel = guild.channels.cache?.get(queueId) ?? await guild.channels.fetch(queueId).catch(() => null);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

      const playersInVC = new Set(voiceChannel.members.keys());
      const validPlayers: string[] = [];
      const validParties = new Map<string, string[]>();

      for (const playerId of state.players) {
        if (playersInVC.has(playerId)) {
          validPlayers.push(playerId);
        } else {
          console.log(`[QueueListener] Player ${playerId} no longer in queue ${queueId}, removing`);
        }
      }

      for (const [partyId, members] of state.parties) {
        const validMembers = members.filter(memberId => playersInVC.has(memberId));
        if (validMembers.length === members.length) {
          validParties.set(partyId, validMembers);
        } else {
          console.log(`[QueueListener] Party ${partyId} has members not in queue ${queueId}, removing party`);
        }
      }


      state.players = validPlayers;
      state.parties = validParties;
      state.lastUpdate = Date.now();

      await this.evictOfflinePlayers(queueId, state, queue, voiceChannel);

      if (!state.processing) {
        queuePlayers.set(queueId, [...state.players]);
      }

      await this.rescanParties(queueId, state, queue, voiceChannel, playersInVC);

      if (!state.processing) {
        queuePlayers.set(queueId, [...state.players]);
      }


      if (state.players.length >= queue.maxPlayers && !state.processing) {
        await this.scheduleQueueProcessing(queueId);
      }

    } catch (error) {
      console.error(`[QueueListener] Error validating queue state for ${queueId}:`, error);
    }
  }

  private async evictOfflinePlayers(queueId: string, state: QueueState, queue: QueueLike, voiceChannel?: VoiceBasedChannel): Promise<void> {
    try {
      if (!PresenceService.isConnected() || state.players.length === 0) return;
      const offlineVersion = PresenceService.getOfflineVersion();
      if (state.lastOfflineVersion === offlineVersion) return;
      state.lastOfflineVersion = offlineVersion;

      let users: QueueUserBadge[];
      try {
        users = await User.find({ discordId: { $in: state.players } }).select('discordId ign').lean();
      } catch (error) {
        console.error(`[QueueListener] Offline eviction lookup failed for ${queueId}:`, error);
        return;
      }
      const ignById = new Map(users.map((u) => [u.discordId, u.ign]));
      const offline = state.players.filter((id) => {
        const ign = ignById.get(id);
        return !!ign && PresenceService.evaluate(ign) === 'offline';
      });
      if (offline.length === 0) return;

      const wasQueueFull = state.players.length >= queue.maxPlayers;
      const offlineSet = new Set(offline);
      const evicted = new Set<string>(offline);
      for (const [partyId, members] of state.parties) {
        if (members.some((m) => offlineSet.has(m))) {
          members.forEach((m) => evicted.add(m));
          state.parties.delete(partyId);
          console.log(`[QueueListener] Party ${partyId} removed from queue ${queueId}: member offline in Minecraft`);
        }
      }
      state.players = state.players.filter((p) => !evicted.has(p));
      state.lastUpdate = Date.now();
      if (!state.processing) {
        queuePlayers.set(queueId, [...state.players]);
      }

      const guild = this.client.guilds.cache.first();
      const waitingVcId = config.voicechannels.waitingvc;
      const reason = 'you went offline on the Minecraft server, so you were removed from the queue. Rejoin the server and queue again!';
      const evictedIds = [...evicted];
      const moved: Array<{ id: string; username: string; channelId?: string | null }> = [];
      for (let i = 0; i < evictedIds.length; i += 5) {
        const chunk = evictedIds.slice(i, i + 5);
        const results = await Promise.allSettled(chunk.map(async (userId) => {
          try {
            const member = voiceChannel?.members.get(userId)
              ?? (guild ? await guild.members.fetch(userId).catch(() => null) : null);
            return member ? { id: userId, username: member.user.username, channelId: member.voice.channelId } : null;
          } catch (error) {
            console.error(`[QueueListener] Error resolving offline player ${userId}:`, error);
            return null;
          }
        }));
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) moved.push(result.value);
        }
      }

      try {
        if (waitingVcId && moved.length > 0) {
          const toMove = moved.filter((m) => m.channelId !== waitingVcId).map((m) => m.id);
          if (toMove.length > 0) {
            await this.workersManager.moveMembers(toMove, waitingVcId, 6);
          }
        }
        if (config.channels.alertsChannel && moved.length > 0) {
          await this.workersManager.sendMessage(
            config.channels.alertsChannel,
            { content: `Hey ${moved.map((m) => `<@${m.id}>`).join(' ')}, ${reason}` },
            7
          );
        }
        for (const m of moved) {
          console.warn(`[QueueListener] User ${m.username} moved to waiting due to: ${reason}`);
        }
      } catch (error) {
        console.error(`[QueueListener] Error moving offline players to waiting:`, error);
      }

      if (wasQueueFull && state.players.length < queue.maxPlayers) {
        console.log(`[QueueListener] Queue ${queueId} dropped below full after offline eviction, stopping processing`);
        this.cancelQueueProcessing(queueId);
      }
    } catch (error) {
      console.error(`[QueueListener] Error evicting offline players for ${queueId}:`, error);
    }
  }

  private async rescanParties(
    queueId: string,
    queueState: QueueState,
    queue: QueueLike,
    voiceChannel: VoiceBasedChannel,
    playersInVC: Set<string>
  ): Promise<void> {
    try {
      const inParty = new Set([...queueState.parties.values()].flat());
      const uncovered = [...playersInVC].filter(id => !inParty.has(id));
      if (uncovered.length === 0) {
        this.rescanKeys.delete(queueId);
        return;
      }
      const key = uncovered.slice().sort().join(',');
      const prev = this.rescanKeys.get(queueId);
      if (prev && prev.key === key) return;
      this.rescanKeys.set(queueId, { key, ts: Date.now() });

      const users = await User.find({ discordId: { $in: uncovered } }).select('discordId partyId ign').lean();
      const ignById = new Map<string, string>();
      const presentByParty = new Map<string, string[]>();
      for (const user of users) {
        if (!user?.partyId || queueState.parties.has(user.partyId)) continue;
        if (user.ign) ignById.set(user.discordId, user.ign);
        const present = presentByParty.get(user.partyId) ?? [];
        present.push(user.discordId);
        presentByParty.set(user.partyId, present);
      }

      const partyIds = [...presentByParty.keys()];
      if (partyIds.length === 0) return;
      const partyDocs = await Party.find({ partyId: { $in: partyIds } }).select('partyId members').lean();
      const rosterById = new Map(partyDocs.map((p) => [p.partyId, p.members as string[]]));
      for (const [partyId, present] of presentByParty) {
        const roster = this.partyCache.get(partyId)?.members ?? rosterById.get(partyId);
        if (!roster) continue;
        this.partyCache.set(partyId, { members: roster, timestamp: Date.now() });
        if (!roster.every(id => playersInVC.has(id))) continue;
        if (PresenceService.isConnected() && present.some((id) => {
          const ign = ignById.get(id);
          return !!ign && PresenceService.evaluate(ign) === 'offline';
        })) continue;
        const member = voiceChannel.members.get(present[0]);
        if (!member) continue;
        await this.handlePartyJoin({ member } as VoiceState, { partyId }, queueState, queue);
      }
    } catch (error) {
      console.error(`[QueueListener] Error rescanning parties for queue ${queueId}:`, error);
    }
  }

  public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      const userId = newState.member?.id;
      if (!userId) return;

      const wasQueueChannel = await this.isQueueChannel(oldState.channelId);
      const isQueueChannel = await this.isQueueChannel(newState.channelId);

      if (!wasQueueChannel && isQueueChannel) {
        await this.handleQueueJoin(newState);
      } else if (wasQueueChannel && !isQueueChannel) {
        await this.handleQueueLeave(oldState);
      } else if (wasQueueChannel && isQueueChannel && oldState.channelId !== newState.channelId) {
        await this.handleQueueSwitch(oldState, newState);
      }
    } catch (error) {
      console.error('[QueueListener] Error in handleVoiceStateUpdate:', error);
    }
  }

  private async isQueueChannel(channelId: string | null | undefined): Promise<boolean> {
    if (!channelId) return false;
    const cached = this.queueChannelCache.get(channelId);
    if (cached && Date.now() - cached.ts < this.CHANNEL_CACHE_TTL) {
      return cached.exists;
    }
    const queue = await Queue.findOne({ channelId }).select('_id').lean();
    const exists = !!queue;
    this.queueChannelCache.set(channelId, { exists, ts: Date.now() });
    return exists;
  }

  private async handleQueueJoin(state: VoiceState): Promise<void> {
    try {
      const queue = await resolveQuery<QueueLike | null>(
        Queue.findOne({ channelId: state.channelId }),
        'channelId maxPlayers minElo maxElo isActive isRanked isPicking queueType bypassRoles'
      );
      if (!queue || queue.isActive === false) {
        await this.moveToWaiting(state, 'This queue is currently disabled.');
        return;
      }

      const userId = state.member?.id;
      if (!userId) return;

      const user = await resolveQuery<Pick<IUser, 'discordId' | 'ign' | 'partyId' | 'elo' | 'isBanned' | 'isFrozen'> | null>(
        User.findOne({ discordId: userId }),
        'discordId ign partyId elo isBanned isFrozen'
      );
      if (!user) {
        await this.moveToWaiting(state, 'you are not registered. Please register to participate. Maybe `/update`?');
        return;
      }

      if (!user.ign) {
        await this.moveToWaiting(state, "you don't have a valid IGN. Please update your profile.");
        return;
      }

      if (user.isBanned || user.isFrozen) {
        await this.moveToWaiting(state, 'you have a restricted role. please contact a staff if you think its a mistake');
        return;
      }

      const member = state.member;
      if (!member) return;

      const hasBypassRole = queue.bypassRoles.some((roleId: string) => member.roles.cache.has(roleId));

      if (!hasBypassRole && (user.elo < queue.minElo || user.elo > queue.maxElo)) {
        await this.moveToWaiting(state, `ELO ${user.elo} not in range (${queue.minElo}-${queue.maxElo})`);
        return;
      }

      const presence = PresenceService.evaluate(user.ign);
      if (presence === 'offline') {
        await this.moveToWaiting(state, `Player is not online, Please make sure to be on \`${config.serverip}\` Minecraft server before joining a queue!`);
        return;
      }

      if (presence === 'unknown') {
        try {
          const onlineCheck = await Promise.race([
            this.wsManager.checkPlayerOnline(user.ign),
            new Promise<{ online: boolean }>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 5000)
            )
          ]).catch(() => null);

          if (onlineCheck === null) {
            console.warn(`[QueueListener] Online check timed out for ${user.ign}, allowing queue join`);
          } else if (!onlineCheck.online) {
            await this.moveToWaiting(state, `Player is not online, Please make sure to be on \`${config.serverip}\` Minecraft server before joining a queue!`);
            return;
          }
        } catch (error) {
          console.warn(`[QueueListener] Could not check online status for ${user.ign}: ${error}`);
          await this.moveToWaiting(state, 'Could not verify online status, Hm? Wierd this shouldn\'t be happening!');
          return;
        }
      }

      let queueState = this.queueStates.get(queue.channelId);
      if (!queueState) {
        queueState = {
          players: [],
          parties: new Map(),
          lastUpdate: Date.now(),
          processing: false
        };
        this.queueStates.set(queue.channelId, queueState);
      }

      const wasQueueFull = queueState.players.length >= queue.maxPlayers;

      if (user.partyId) {
        const partyResult = await this.handlePartyJoin(state, user, queueState, queue);
        if (!partyResult.success) {
          return;
        }
      } else {
        if (!queueState.players.includes(userId)) {
          queueState.players.push(userId);
        }
      }

      queueState.lastUpdate = Date.now();
      queuePlayers.set(queue.channelId, [...queueState.players]);

      const isQueueFull = queueState.players.length >= queue.maxPlayers;

      if (isQueueFull && !wasQueueFull) {
        console.log(`[QueueListener] Queue ${queue.channelId} just became full, scheduling processing`);
        await this.scheduleQueueProcessing(queue.channelId);
      }

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueJoin:', error);
      await this.moveToWaiting(state, 'Internal error');
    }
  }

  private async handlePartyJoin(
    state: VoiceState,
    user: { partyId?: string | null },
    queueState: QueueState,
    queue: QueueLike
  ): Promise<{ success: boolean }> {
    try {
      const partyId = user.partyId;
      if (!partyId) {
        await this.moveToWaiting(state, 'Invalid party');
        return { success: false };
      }

      let partyMembers = this.partyCache.get(partyId)?.members;

      if (!partyMembers) {
        const party = await resolveQuery<{ partyId: string; members?: string[] } | null>(
          Party.findOne({ partyId }),
          'partyId members'
        );
        if (!party || !party.members) {
          await this.moveToWaiting(state, 'Invalid party');
          return { success: false };
        }

        partyMembers = party.members;
        this.partyCache.set(partyId, {
          members: partyMembers,
          timestamp: Date.now()
        });
      }

      const isValidPartySize = await this.validatePartySize(state, partyMembers);
      if (!isValidPartySize) {
        return { success: false };
      }

      const partyUsersPromise = User.find({
        discordId: { $in: partyMembers }
      }).select('discordId elo isBanned isFrozen').lean();

      const activeGamePromise = resolveQuery<{ gameId: number } | null>(
        Game.findOne({
          $or: [
            { team1: { $in: partyMembers } },
            { team2: { $in: partyMembers } }
          ],
          state: { $in: ['pending', 'active'] }
        }),
        'gameId'
      );

      const [partyUsers, activeGame] = await Promise.all([partyUsersPromise, activeGamePromise]);

      if (partyUsers.length !== partyMembers.length) {
        await this.moveToWaiting(state, 'Some party members not found');
        return { success: false };
      }

      for (const member of partyUsers) {
        if (member.isBanned || member.isFrozen) {
          await this.moveToWaiting(state, `Party member is banned or frozen`);
          return { success: false };
        }

        if (member.elo < queue.minElo || member.elo > queue.maxElo) {
          await this.moveToWaiting(state, `Party member ELO not in queue range`);
          return { success: false };
        }
      }

      if (activeGame) {
        await this.moveToWaiting(state, `Party member in game #${activeGame.gameId}`);
        return { success: false };
      }

      const guild = this.client.guilds.cache.first();
      if (!guild) return { success: false };

      const voiceChannel = guild.channels.cache?.get(queue.channelId) ?? await guild.channels.fetch(queue.channelId).catch(() => null);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) return { success: false };

      const playersInVC = new Set(voiceChannel.members.keys());
      const membersInVC = partyMembers.filter(memberId => playersInVC.has(memberId));

      if (membersInVC.length !== partyMembers.length) {
        console.log(`[QueueListener] Party ${partyId}: waiting for ${partyMembers.length - membersInVC.length} member(s) to join queue ${queue.channelId}`);
        return { success: false };
      }

      queueState.parties.set(partyId, partyMembers);

      for (const memberId of partyMembers) {
        if (!queueState.players.includes(memberId)) {
          queueState.players.push(memberId);
        }
      }

      console.log(`[QueueListener] Party ${partyId} (${partyMembers.length} members) joined queue ${queue.channelId}`);

      return { success: true };

    } catch (error) {
      console.error('[QueueListener] Error in handlePartyJoin:', error);
      await this.moveToWaiting(state, 'Party join error');
      return { success: false };
    }
  }

  private async handleQueueLeave(state: VoiceState): Promise<void> {
    try {
      const queue = await resolveQuery<QueueLike | null>(
        Queue.findOne({ channelId: state.channelId }),
        'channelId maxPlayers isActive'
      );
      if (!queue || queue.isActive === false) {

        return;
      }

      const userId = state.member?.id;
      if (!userId) return;

      const user = await resolveQuery<Pick<IUser, 'discordId' | 'partyId'> | null>(
        User.findOne({ discordId: userId }),
        'discordId partyId'
      );
      if (!user) return;

      const queueState = this.queueStates.get(queue.channelId);
      if (!queueState) return;

      const wasQueueFull = queueState.players.length >= queue.maxPlayers;

      if (user.partyId) {
        await updatePartyActivity(user.partyId);

        const partyMembers = queueState.parties.get(user.partyId) || [];
        const partyInQueue = partyMembers.length > 0 ? partyMembers : [userId];
        queueState.players = queueState.players.filter(p => !partyInQueue.includes(p));
        queueState.parties.delete(user.partyId);
        console.log(`[QueueListener] Party ${user.partyId} removed from queue ${queue.channelId} after member ${userId} left`);
      } else {

        queueState.players = queueState.players.filter(p => p !== userId);
        console.log(`[QueueListener] Player ${userId} left queue ${queue.channelId}`);
      }

      queueState.lastUpdate = Date.now();
      queuePlayers.set(queue.channelId, [...queueState.players]);

      const isQueueFull = queueState.players.length >= queue.maxPlayers;

      console.log(`[QueueListener] Queue ${queue.channelId}: ${queueState.players.length}/${queue.maxPlayers} players remaining`);


      if (wasQueueFull && !isQueueFull) {
        console.log(`[QueueListener] Queue ${queue.channelId} is no longer full, stopping processing`);
        this.cancelQueueProcessing(queue.channelId);
      }

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueLeave:', error);
    }
  }

  private async handleQueueSwitch(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {

      await this.handleQueueLeave(oldState);


      await this.handleQueueJoin(newState);

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueSwitch:', error);
    }
  }

  private async scheduleQueueProcessing(queueId: string): Promise<void> {
    try {

      this.cancelQueueProcessing(queueId);

      const queueState = this.queueStates.get(queueId);
      if (!queueState || queueState.processing) return;

      queueState.processing = true;

      const timeout = setTimeout(async () => {
        try {
          await this.matchmaker.processQueue(queueId);
        } catch (error) {
          console.error(`[QueueListener] Error processing queue ${queueId}:`, error);
        } finally {
          const state = this.queueStates.get(queueId);
          if (state) {
            state.processing = false;
          }
          this.processingLocks.delete(queueId);
          await this.validateQueueState(queueId);
        }
      }, 1000);

      this.processingLocks.set(queueId, timeout);

    } catch (error) {
      console.error(`[QueueListener] Error scheduling queue processing for ${queueId}:`, error);
    }
  }

  private cancelQueueProcessing(queueId: string): void {
    const timeout = this.processingLocks.get(queueId);
    if (timeout) {
      clearTimeout(timeout);
      this.processingLocks.delete(queueId);
    }
  }

  private async moveToWaiting(state: VoiceState, reason: string): Promise<void> {
    try {
      const member = state.member;
      if (!member) return;


      const waitingVcId = config.voicechannels.waitingvc;
      if (waitingVcId && member.voice.channelId !== waitingVcId) {
        await this.workersManager.moveMembers([member.id], waitingVcId, 6);
      }

      const mention = `<@${member.id}>`;
      const message = `Hey ${mention}, ${reason}`;

      if (config.channels.alertsChannel) {
        await this.workersManager.sendMessage(
          config.channels.alertsChannel,
          { content: message },
          7
        );
      }

      console.warn(`[QueueListener] User ${member.user.username} moved to waiting due to: ${reason}`);
    } catch (error) {
      console.error('[QueueListener] Error moving to waiting:', error);
    }
  }

  private async validatePartySize(state: VoiceState, partyMembers: string[]): Promise<boolean> {
    try {
      const member = state.member;
      if (!member) return false;

      const partySize = partyMembers.length;
      const roles = {
        [config.roles.partyof2Queue]: 2,
        [config.roles.partyof3Queue]: 3,
        [config.roles.partyof4Queue]: 4
      };

      let highestAllowedSize = config.CommonPartySize || 1;
      for (const [roleId, size] of Object.entries(roles)) {
        if (member.roles.cache.has(roleId) && size > highestAllowedSize) {
          highestAllowedSize = size;
        }
      }

      if (partySize > highestAllowedSize) {
        await this.moveToWaiting(state, `Party too large (${partySize} > ${highestAllowedSize})`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[QueueListener] Error validating party size:', error);
      return false;
    }
  }

  public getMatchmaker(): CentralizedMatchmaker {
    return this.matchmaker;
  }

  public getQueueStats(): Record<string, { players: number, parties: number, processing: boolean }> {
    const stats: Record<string, { players: number, parties: number, processing: boolean }> = {};

    for (const [queueId, state] of this.queueStates.entries()) {
      stats[queueId] = {
        players: state.players.length,
        parties: state.parties.size,
        processing: state.processing
      };
    }

    return stats;
  }


  public cleanup(): void {
    try {

      for (const timeout of this.processingLocks.values()) {
        clearTimeout(timeout);
      }
      this.processingLocks.clear();


      this.queueStates.clear();
      this.partyCache.clear();

      this.matchmaker.cleanup();
      console.log('[QueueListener] Cleanup completed');
    } catch (error) {
      console.error('[QueueListener] Error during cleanup:', error);
    }
  }
}