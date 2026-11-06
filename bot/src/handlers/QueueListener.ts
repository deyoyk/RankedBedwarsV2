import { Client, VoiceState } from 'discord.js';
import type { VoiceBasedChannel } from 'discord.js';
import Queue from '../models/Queue';
import User, { type IUser } from '../models/User';
import Party from '../models/Party';
import config from '../config/config';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { CentralizedMatchmaker } from '../Matchmaking/CentralizedMatchmaker';
import { GameManager } from '../Matchmaking/GameManager';
import { WorkersManager } from '../managers/WorkersManager';
import { queuePlayers } from '../types/queuePlayersMemory';
import { PresenceService } from '../services/PresenceService';
import { maxPartySizeForQueue } from '../utils/partyQueue';
import { findInGamePlayerIds, isIgnInGame, getPlayerIGNs as resolvePlayerIgns } from '../Matchmaking/utils';

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
  private playerLocks: Map<string, Promise<void>> = new Map();
  private queueLocks: Map<string, Promise<void>> = new Map();
  private queueMonitorRunning = false;
  private presenceSweepRunning = false;
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  private queueMonitorInterval: NodeJS.Timeout | null = null;
  private presenceSweepInterval: NodeJS.Timeout | null = null;
  private queueStatusInterval: NodeJS.Timeout | null = null;
  private initialPresenceSweep: NodeJS.Timeout | null = null;
  private readonly queueStatusCache = new Map<string, string>();
  private readonly playerIgnById = new Map<string, string>();
  private initialized = false;
  private shuttingDown = false;
  private linkOfflineNotified = false;
  private readonly CACHE_TTL = 30000;
  private readonly QUEUE_CHECK_INTERVAL = 5000;
  private readonly QUEUE_STATUS_INTERVAL = 3000;
  private readonly CHANNEL_CACHE_TTL = 30000;
  private readonly PRESENCE_SWEEP_INTERVAL = (() => {
    const configured = Number.parseInt(process.env.PRESENCE_SWEEP_INTERVAL_MS ?? '', 10);
    return Number.isFinite(configured) ? Math.max(10000, configured) : 60000;
  })();

  constructor(client: Client, wsManager: WebSocketManager, gameManager: GameManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.workersManager = WorkersManager.getInstance();
    this.matchmaker = new CentralizedMatchmaker(client, wsManager, gameManager);
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.shuttingDown = false;
    await this.matchmaker.recoverPickingSessions();
    await this.hydrateQueueStates();
    this.startCacheCleanup();
    this.startQueueMonitor();
    this.startPresenceSweep();
    this.startQueueStatusUpdates();
    this.initialPresenceSweep = setTimeout(() => {
      const wsConnected = typeof this.wsManager.isConnected === 'function'
        ? this.wsManager.isConnected()
        : true;
      if (PresenceService.isConnected() && wsConnected) {
        void this.sweepUnknownPresence().catch((error) => {
          console.error('[QueueListener] Initial presence sweep failed:', error);
        });
      }
    }, 10000);
    this.initialPresenceSweep.unref?.();
    console.log(`[QueueListener] Queue listener initialized with ${this.queueStates.size} queue(s) and ${[...this.queueStates.values()].reduce((total, state) => total + state.players.length, 0)} queued player(s)`);
  }

  private startQueueStatusUpdates(): void {
    if (this.queueStatusInterval) return;
    this.queueStatusInterval = setInterval(() => {
      void this.updateQueueStatuses().catch((error) => {
        console.error('[QueueListener] Error updating queue channel statuses:', error);
      });
    }, this.QUEUE_STATUS_INTERVAL);
    this.queueStatusInterval.unref?.();
    console.log('[QueueListener] Queue channel status updates started (every 3s)');
  }

  private async updateQueueStatuses(): Promise<void> {
    if (this.shuttingDown) return;
    const workers = this.workersManager as WorkersManager | undefined;
    if (!workers || typeof workers.setChannelStatus !== 'function') return;

    const queues = await resolveQuery<Array<{ channelId: string; maxPlayers: number }>>(
      Queue.find({ isActive: true }).select('channelId maxPlayers'),
      'channelId maxPlayers'
    );
    const activeIds = new Set(queues.map(queue => queue.channelId));

    for (const queue of queues) {
      const state = this.queueStates.get(queue.channelId);
      const linkOnline = this.isMinecraftLinkOnline();
      const queuedPlayers = [...new Set(queuePlayers.get(queue.channelId) ?? state?.players ?? [])];
      if (linkOnline) {
        await this.ensurePlayerIgns(queuedPlayers);
      }
      const onlineIds = new Set<string>();
      if (linkOnline) {
        for (const id of queuedPlayers) {
          const ign = this.playerIgnById.get(id);
          if (ign && PresenceService.evaluate(ign) === 'online') {
            onlineIds.add(id);
          }
        }
      }
      const current = linkOnline ? onlineIds.size : 0;
      const parties = linkOnline && state
        ? [...state.parties.values()].filter(members => members.some(id => onlineIds.has(id))).length
        : 0;
      const partyLabel = `${parties} ${parties === 1 ? 'party' : 'parties'}`;
      const status = `In queue ${current}/${queue.maxPlayers} • ${partyLabel}`;
      if (this.queueStatusCache.get(queue.channelId) === status) continue;

      try {
        await workers.setChannelStatus(queue.channelId, status);
        this.queueStatusCache.set(queue.channelId, status);
        console.log(`[QueueListener] Queue status updated for ${this.queueLabelById(queue.channelId)}: ${status}`);
      } catch (error) {
        console.warn(`[QueueListener] Could not set status for queue ${this.queueLabelById(queue.channelId)}: ${error}`);
      }
    }

    for (const channelId of [...this.queueStatusCache.keys()]) {
      if (activeIds.has(channelId)) continue;
      try {
        await workers.setChannelStatus(channelId, null);
        console.log(`[QueueListener] Queue status cleared for ${this.queueLabelById(channelId)}`);
      } catch {
        // Queue channel may already be gone.
      }
      this.queueStatusCache.delete(channelId);
    }
  }

  private async hydrateQueueStates(): Promise<void> {
    try {
      const queues = await resolveQuery<QueueLike[]>(
        Queue.find({ isActive: true }),
        'channelId maxPlayers minElo maxElo isActive isRanked isPicking queueType bypassRoles'
      );
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.warn('[QueueListener] No guild available during queue recovery');
        return;
      }

      if (!this.isMinecraftLinkOnline()) {
        for (const queue of queues) {
          this.queueStates.set(queue.channelId, {
            players: [],
            parties: new Map(),
            lastUpdate: Date.now(),
            processing: false,
          });
          queuePlayers.set(queue.channelId, []);
        }
        console.warn(`[QueueListener] Queue recovery skipped: Minecraft link is offline (${queues.length} queue(s) left empty)`);
        return;
      }

      let recovered = 0;
      for (const queue of queues) {
        const voiceChannel = guild.channels.cache?.get(queue.channelId)
          ?? await guild.channels.fetch(queue.channelId).catch(() => null);
        if (!voiceChannel || !voiceChannel.isVoiceBased()) continue;

        const memberIds = [...voiceChannel.members.keys()];
        if (memberIds.length === 0) {
          this.queueStates.set(queue.channelId, {
            players: [],
            parties: new Map(),
            lastUpdate: Date.now(),
            processing: false,
          });
          queuePlayers.set(queue.channelId, []);
          console.log(`[QueueListener] Recovered empty queue ${voiceChannel.name} (${queue.channelId})`);
          continue;
        }

        const users = await User.find({ discordId: { $in: memberIds } })
          .select('discordId ign partyId isBanned isFrozen')
          .lean() as Array<{
            discordId: string;
            ign?: string;
            partyId?: string | null;
            isBanned?: boolean;
            isFrozen?: boolean;
          }>;
        for (const user of users) {
          if (user.ign) this.playerIgnById.set(user.discordId, user.ign);
        }
        const eligible = users.filter(user => user.ign && !user.isBanned && !user.isFrozen);
        const eligibleIds = new Set(eligible.map(user => user.discordId));

        const partyIds = [...new Set(eligible.map(user => user.partyId).filter((id): id is string => Boolean(id)))];
        const partyDocs = partyIds.length > 0
          ? await Party.find({ partyId: { $in: partyIds } }).select('partyId members').lean()
          : [];
        const partyById = new Map(partyDocs.map(party => [party.partyId, party.members as string[]]));

        const parties = new Map<string, string[]>();
        for (const partyId of partyIds) {
          const roster = partyById.get(partyId);
          if (!roster) continue;
          if (roster.every(id => eligibleIds.has(id))) {
            parties.set(partyId, roster);
          }
        }

        const inRecoveredParty = new Set([...parties.values()].flat());
        const soloPlayers = eligible
          .filter(user => !user.partyId || !partyById.has(user.partyId))
          .map(user => user.discordId);
        const players = [...new Set([...soloPlayers, ...inRecoveredParty])];
        const inGame = await this.findInGamePlayers(players);
        const activePlayers = players.filter(id => !inGame.has(id));
        for (const [partyId, members] of parties) {
          if (members.some(id => inGame.has(id))) {
            parties.delete(partyId);
          }
        }
        if (inGame.size > 0) {
          console.log(`[QueueListener] Recovery excluded ${inGame.size} player(s) already in an active game from ${voiceChannel.name} (${queue.channelId})`);
        }

        this.queueStates.set(queue.channelId, {
          players: activePlayers,
          parties,
          lastUpdate: Date.now(),
          processing: false,
        });
        queuePlayers.set(queue.channelId, activePlayers);
        recovered += activePlayers.length;

        if (activePlayers.length > 0) {
          const names = eligible
            .filter(user => activePlayers.includes(user.discordId))
            .map(user => user.ign)
            .filter(Boolean)
            .join(', ');
          console.log(`[QueueListener] Recovered ${activePlayers.length} player(s) into queue ${voiceChannel.name} (${queue.channelId})${names ? `: ${names}` : ''}`);
        }
      }

      console.log(`[QueueListener] Recovered ${recovered} queued player(s) across ${queues.length} queue(s)`);
    } catch (error) {
      console.error('[QueueListener] Error recovering queue state:', error);
    }
  }

  private startCacheCleanup(): void {
    this.cacheCleanupInterval = setInterval(() => {
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
    this.cacheCleanupInterval.unref?.();
    console.log('[QueueListener] Cache cleanup started (every 60s)');
  }

  private startQueueMonitor(): void {
    this.queueMonitorInterval = setInterval(async () => {
      if (this.queueMonitorRunning) return;
      this.queueMonitorRunning = true;
      try {
        await this.checkAllQueues();
      } finally {
        this.queueMonitorRunning = false;
      }
    }, this.QUEUE_CHECK_INTERVAL);
    this.queueMonitorInterval.unref?.();
    console.log('[QueueListener] Queue monitor started (every 5s)');
  }

  private startPresenceSweep(): void {
    this.presenceSweepInterval = setInterval(async () => {
      if (this.presenceSweepRunning) return;
      this.presenceSweepRunning = true;
      try {
        await this.sweepUnknownPresence().catch((error) => {
          console.error('[QueueListener] Error in presence sweep:', error);
        });
      } finally {
        this.presenceSweepRunning = false;
      }
    }, this.PRESENCE_SWEEP_INTERVAL);
    this.presenceSweepInterval.unref?.();
    console.log(`[QueueListener] Presence sweep started (every ${Math.round(this.PRESENCE_SWEEP_INTERVAL / 1000)}s)`);
  }

  private async sweepUnknownPresence(): Promise<void> {
    if (!this.isMinecraftLinkOnline()) {
      console.log('[QueueListener] Presence sweep skipped: Minecraft link is offline');
      return;
    }
    const now = Date.now();
    const entries = [...this.queueStates.entries()];
    for (let i = 0; i < entries.length; i += QueueListener.SWEEP_CONCURRENCY) {
      const chunk = entries.slice(i, i + QueueListener.SWEEP_CONCURRENCY);
      await Promise.allSettled(chunk.map(([queueId, state]) => this.sweepQueuePresence(queueId, state, now)));
    }
  }

  private async sweepQueuePresence(queueId: string, state: QueueState, now: number): Promise<void> {
    if (state.players.length === 0) return;
    await this.ensurePlayerIgns(state.players);
    const unknown = state.players
      .map(id => this.playerIgnById.get(id))
      .filter((ign): ign is string => Boolean(ign) && PresenceService.evaluate(ign, now) === 'unknown');
    if (unknown.length > 0) {
      console.log(`[QueueListener] Presence sweep re-checking ${unknown.length} player(s) in queue ${this.queueLabelById(queueId)}`);
    }
    for (let j = 0; j < unknown.length; j += 5) {
      const batch = unknown.slice(j, j + 5);
      const results = await Promise.allSettled(batch.map((ign) => this.wsManager.checkPlayerOnline(ign)));
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && typeof result.value.online === 'boolean') {
          PresenceService.ingest(batch[index], result.value.online);
        }
      });
    }
    if (unknown.length > 0) {
      const statuses = unknown.map(ign => PresenceService.evaluate(ign, Date.now()));
      const unresolvedIgns = unknown.filter((ign, index) => statuses[index] === 'unknown');
      for (const ign of unresolvedIgns) {
        PresenceService.ingest(ign, false);
        console.warn(`[QueueListener] Presence sweep: treating ${ign} as offline in ${this.queueLabelById(queueId)} because the server did not respond`);
      }
      const finalStatuses = unknown.map(ign => PresenceService.evaluate(ign, Date.now()));
      const online = finalStatuses.filter(status => status === 'online').length;
      const offline = finalStatuses.filter(status => status === 'offline').length;
      console.log(`[QueueListener] Presence sweep result for ${this.queueLabelById(queueId)}: ${online} online, ${offline} offline, ${unresolvedIgns.length} forced offline`);
    }
  }

  private static readonly QUEUE_TICK_CONCURRENCY = 5;
  private static readonly SWEEP_CONCURRENCY = 5;

  private async checkAllQueues(): Promise<void> {
    try {
      if (this.pauseQueueWorkIfLinkOffline('Queue monitor')) return;
      const queues = await resolveQuery<QueueLike[]>(
        Queue.find({ isActive: true }),
        'channelId maxPlayers minElo maxElo isActive isRanked isPicking queueType bypassRoles'
      );
      const queuedPlayers = [...this.queueStates.values()].reduce((total, state) => total + state.players.length, 0);

      for (let i = 0; i < queues.length; i += QueueListener.QUEUE_TICK_CONCURRENCY) {
        const chunk = queues.slice(i, i + QueueListener.QUEUE_TICK_CONCURRENCY);
        await Promise.allSettled(chunk.map((queue) => this.validateQueueState(queue.channelId, queue)));
      }
    } catch (error) {
      console.error('[QueueListener] Error in queue monitor:', error);
    }
  }

  private async validateQueueState(queueId: string, preloadedQueue?: QueueLike): Promise<void> {
    if (this.shuttingDown) return;
    await this.withQueueLock(queueId, () => this.validateQueueStateUnlocked(queueId, preloadedQueue));
  }

  private async validateQueueStateUnlocked(queueId: string, preloadedQueue?: QueueLike): Promise<void> {
    if (this.pauseQueueWorkIfLinkOffline(`Queue check ${queueId}`)) return;
    try {
      let queue: QueueLike | null = preloadedQueue ?? null;
      if (!queue) {
        queue = await resolveQuery<QueueLike | null>(
          Queue.findOne({ channelId: queueId }),
          'channelId maxPlayers minElo maxElo isRanked isPicking queueType bypassRoles'
        );
      }
      if (!queue) {
        console.log(`[QueueListener] Queue ${queueId} no longer exists, dropping in-memory state`);
        this.queueStates.delete(queueId);
        return;
      }

      const state = this.queueStates.get(queueId);
      if (!state) return;

      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.warn(`[QueueListener] Queue check skipped for ${queueId}: no guild available`);
        return;
      }

      const voiceChannel = guild.channels.cache?.get(queueId) ?? await guild.channels.fetch(queueId).catch(() => null);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        console.warn(`[QueueListener] Queue check skipped for ${queueId}: voice channel missing or invalid`);
        return;
      }

      const playersInVC = new Set(voiceChannel.members.keys());
      const validPlayers: string[] = [];
      const validParties = new Map<string, string[]>();
      const queueLabel = `${voiceChannel.name} (${queueId})`;
      const missingPlayers: string[] = [];
      const beforePlayers = state.players.length;
      const beforeParties = state.parties.size;

      if (beforePlayers > 0 || beforeParties > 0) {
        console.log(`[QueueListener] Queue check ${queueLabel}: ${beforePlayers}/${queue.maxPlayers} players, ${beforeParties} parties, ${playersInVC.size} in voice`);
      }

      for (const playerId of state.players) {
        if (playersInVC.has(playerId)) {
          validPlayers.push(playerId);
        } else {
          missingPlayers.push(playerId);
        }
      }

      if (missingPlayers.length > 0) {
        const labels = await this.playerIgnMap(missingPlayers);
        for (const playerId of missingPlayers) {
          console.log(`[QueueListener] ${labels.get(playerId) ?? playerId} no longer in queue ${queueLabel}, removing`);
        }
      }

      for (const [partyId, members] of state.parties) {
        const validMembers = members.filter(memberId => playersInVC.has(memberId));
        if (validMembers.length === members.length) {
          validParties.set(partyId, validMembers);
        } else {
          const labels = await this.playerIgnMap(members);
          const memberNames = members.map(memberId => labels.get(memberId) ?? memberId).join(', ');
          console.log(`[QueueListener] Party ${partyId} (${memberNames}) has members not in queue ${queueLabel}, removing party`);
        }
      }

      const inGameIds = await this.findInGamePlayers(state.players);
      if (inGameIds.size > 0) {
        const labels = await this.playerIgnMap([...inGameIds]);
        for (const playerId of inGameIds) {
          console.log(`[QueueListener] ${labels.get(playerId) ?? playerId} is in an active game, removing from queue ${queueLabel}`);
          playersInVC.delete(playerId);
        }
        for (const [partyId, members] of validParties) {
          if (members.some(m => inGameIds.has(m))) {
            validParties.delete(partyId);
          }
        }
      }

      state.players = validPlayers.filter(p => !inGameIds.has(p));
      state.parties = validParties;
      state.lastUpdate = Date.now();

      const evicted = await this.evictOfflinePlayers(queueId, state, queue, voiceChannel);
      for (const playerId of evicted) {
        playersInVC.delete(playerId);
      }

      if (!state.processing) {
        queuePlayers.set(queueId, [...state.players]);
      }

      await this.rescanParties(queueId, state, queue, voiceChannel, playersInVC);

      if (!state.processing) {
        queuePlayers.set(queueId, [...state.players]);
      }

      await this.ensurePlayerIgns(state.players);

      if (state.players.length >= queue.maxPlayers && !state.processing) {
        console.log(`[QueueListener] Queue ${queueLabel} is full (${state.players.length}/${queue.maxPlayers}), scheduling processing`);
        await this.scheduleQueueProcessing(queueId);
      } else if (state.players.length !== beforePlayers || state.parties.size !== beforeParties) {
        console.log(`[QueueListener] Queue check ${queueLabel} updated: ${beforePlayers} -> ${state.players.length} players, ${beforeParties} -> ${state.parties.size} parties`);
      }

    } catch (error) {
      console.error(`[QueueListener] Error validating queue state for ${queueId}:`, error);
    }
  }

  private async evictOfflinePlayers(queueId: string, state: QueueState, queue: QueueLike, voiceChannel?: VoiceBasedChannel): Promise<Set<string>> {
    try {
      if (!PresenceService.isConnected() || state.players.length === 0) return new Set();
      const offlineVersion = PresenceService.getOfflineVersion();
      if (state.lastOfflineVersion === offlineVersion) return new Set();
      state.lastOfflineVersion = offlineVersion;

      let users: Array<{ discordId: string; ign: string }>;
      try {
        await this.ensurePlayerIgns(state.players);
        users = state.players
          .map((id) => ({ discordId: id, ign: this.playerIgnById.get(id) }))
          .filter((user): user is { discordId: string; ign: string } => Boolean(user.ign));
      } catch (error) {
        console.error(`[QueueListener] Offline eviction lookup failed for ${queueId}:`, error);
        return new Set();
      }
      const ignById = new Map(users.map((u) => [u.discordId, u.ign]));
      const offline = state.players.filter((id) => {
        const ign = ignById.get(id);
        return !!ign && PresenceService.evaluate(ign) === 'offline';
      });
      if (offline.length === 0) return new Set();

      const wasQueueFull = state.players.length >= queue.maxPlayers;
      const offlineSet = new Set(offline);
      const evicted = new Set<string>(offline);
      const queueLabel = voiceChannel?.name ? `${voiceChannel.name} (${queueId})` : queueId;
      const offlineNames = offline.map(id => ignById.get(id) ?? id).join(', ');
      console.log(`[QueueListener] Queue ${queueLabel}: evicting ${offline.length} offline player(s): ${offlineNames}`);
      for (const [partyId, members] of state.parties) {
        if (members.some((m) => offlineSet.has(m))) {
          members.forEach((m) => evicted.add(m));
          state.parties.delete(partyId);
          const memberNames = members.map(memberId => ignById.get(memberId) ?? memberId).join(', ');
          console.log(`[QueueListener] Party ${partyId} (${memberNames}) removed from queue ${queueLabel}: member offline in Minecraft`);
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
            await this.workersManager.moveMembers(toMove, waitingVcId, 8);
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
          console.warn(`[QueueListener] ${ignById.get(m.id) ?? m.username} moved to waiting due to: ${reason}`);
        }
      } catch (error) {
        console.error(`[QueueListener] Error moving offline players to waiting:`, error);
      }

      if (wasQueueFull && state.players.length < queue.maxPlayers) {
        console.log(`[QueueListener] Queue ${queueLabel} dropped below full after offline eviction, stopping processing`);
        this.cancelQueueProcessing(queueId);
      }
      return evicted;
    } catch (error) {
      console.error(`[QueueListener] Error evicting offline players for ${queueId}:`, error);
      return new Set();
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
      // Scan every non-party member, not only players missing from memory.
      // A solo can form a party after joining, and a solo missing from memory
      // must be re-added instead of being silently dropped during an await.
      const uncovered = [...playersInVC].filter(id => !inParty.has(id));
      if (uncovered.length === 0) {
        this.rescanKeys.delete(queueId);
        return;
      }
      const key = uncovered.slice().sort().join(',');
      const prev = this.rescanKeys.get(queueId);
      if (prev && prev.key === key && Date.now() - prev.ts < 15000) return;
      this.rescanKeys.set(queueId, { key, ts: Date.now() });
      console.log(`[QueueListener] Party rescan ${this.queueLabelById(queueId)}: ${uncovered.length} uncovered member(s), ${queueState.parties.size} known party/parties`);

      const users = await User.find({ discordId: { $in: uncovered } })
        .select('discordId partyId ign isBanned isFrozen')
        .lean() as Array<{
          discordId: string;
          partyId?: string | null;
          ign?: string;
          isBanned?: boolean;
          isFrozen?: boolean;
        }>;
      const uncoveredSet = new Set(uncovered);
      const ignById = new Map<string, string>();
      const presentByParty = new Map<string, string[]>();
      const soloIds: string[] = [];
      for (const user of users) {
        if (!user || !uncoveredSet.has(user.discordId) || user.isBanned || user.isFrozen) continue;
        if (user.ign) {
          ignById.set(user.discordId, user.ign);
          this.playerIgnById.set(user.discordId, user.ign);
        }
        if (!user.partyId) {
          if (user.ign) {
            const presence = PresenceService.evaluate(user.ign);
            if (presence !== 'offline') soloIds.push(user.discordId);
          }
          continue;
        }
        if (queueState.parties.has(user.partyId)) continue;
        const present = presentByParty.get(user.partyId) ?? [];
        present.push(user.discordId);
        presentByParty.set(user.partyId, present);
      }

      const soloInGame = await this.findInGamePlayers(soloIds);
      if (soloInGame.size > 0) {
        console.log(`[QueueListener] Recovery excluded ${soloInGame.size} solo player(s) already in an active game from ${this.queueLabelById(queueId)}`);
      }
      for (const id of soloIds) {
        if (soloInGame.has(id) || queueState.players.includes(id)) continue;
        queueState.players.push(id);
        queuePlayers.set(queueId, [...queueState.players]);
        console.log(`[QueueListener] Recovered solo queue member ${ignById.get(id) ?? id} in queue ${this.queueLabelById(queueId)}`);
      }

      const partyIds = [...presentByParty.keys()];
      if (partyIds.length === 0) return;
      const partyDocs = await Party.find({ partyId: { $in: partyIds } }).select('partyId members').lean();
      const rosterById = new Map(partyDocs.map((p) => [p.partyId, p.members as string[]]));
      for (const [partyId, present] of presentByParty) {
        const roster = rosterById.get(partyId) ?? this.partyCache.get(partyId)?.members;
        if (!roster) {
          console.warn(`[QueueListener] Party ${partyId} has no roster, skipping recovery in ${this.queueLabelById(queueId)}`);
          continue;
        }
        this.partyCache.set(partyId, { members: roster, timestamp: Date.now() });
        if (!roster.every(id => playersInVC.has(id))) {
          console.log(`[QueueListener] Party ${partyId} is not fully in queue ${this.queueLabelById(queueId)}, waiting for members`);
          continue;
        }
        if (PresenceService.isConnected() && present.some((id) => {
          const ign = ignById.get(id);
          return !!ign && PresenceService.evaluate(ign) === 'offline';
        })) {
          console.log(`[QueueListener] Party ${partyId} has an offline member, skipping recovery in ${this.queueLabelById(queueId)}`);
          continue;
        }
        const member = voiceChannel.members.get(present[0]);
        if (!member) {
          console.warn(`[QueueListener] Party ${partyId} member ${present[0]} is missing from voice cache in ${this.queueLabelById(queueId)}`);
          continue;
        }
        await this.handlePartyJoin({ member } as VoiceState, { partyId, ign: ignById.get(present[0]) }, queueState, queue);
      }
    } catch (error) {
      console.error(`[QueueListener] Error rescanning parties for queue ${queueId}:`, error);
    }
  }

  public async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      const userId = newState.member?.id;
      if (!userId) return;

      await this.withPlayerLock(userId, async () => {
        const [wasQueueChannel, isQueueChannel] = await Promise.all([
          this.isQueueChannel(oldState.channelId),
          this.isQueueChannel(newState.channelId)
        ]);

        if (!wasQueueChannel && isQueueChannel) {
          console.log(`[QueueListener] Queue event: ${userId} entered ${this.queueLabel(newState)}`);
          await this.handleQueueJoin(newState);
        } else if (wasQueueChannel && !isQueueChannel) {
          console.log(`[QueueListener] Queue event: ${userId} left ${this.queueLabel(oldState)}`);
          await this.handleQueueLeave(oldState);
        } else if (wasQueueChannel && isQueueChannel && oldState.channelId !== newState.channelId) {
          console.log(`[QueueListener] Queue event: ${userId} switched ${this.queueLabel(oldState)} -> ${this.queueLabel(newState)}`);
          await this.handleQueueSwitch(oldState, newState);
        }
      });
    } catch (error) {
      console.error('[QueueListener] Error in handleVoiceStateUpdate:', error);
    }
  }

  private async withPlayerLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.playerLocks.get(userId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>(resolve => { release = resolve; });
    const chain = previous.then(() => current, () => current);
    this.playerLocks.set(userId, chain);
    try {
      await previous;
    } catch {
      console.warn(`[QueueListener] Recovered a poisoned player lock for ${userId}`);
    }
    try {
      return await fn();
    } finally {
      release();
      void chain.then(() => {
        if (this.playerLocks.get(userId) === chain) {
          this.playerLocks.delete(userId);
        }
      });
    }
  }

  private async withQueueLock<T>(queueId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queueLocks.get(queueId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>(resolve => { release = resolve; });
    const chain = previous.then(() => current, () => current);
    this.queueLocks.set(queueId, chain);
    try {
      await previous;
    } catch {
      console.warn(`[QueueListener] Recovered a poisoned queue lock for ${queueId}`);
    }
    try {
      return await fn();
    } finally {
      release();
      void chain.then(() => {
        if (this.queueLocks.get(queueId) === chain) {
          this.queueLocks.delete(queueId);
        }
      });
    }
  }

  private removeFromOtherQueues(userIds: string[], exceptChannelId: string): void {
    if (userIds.length === 0) return;
    const remove = new Set(userIds);
    for (const [channelId, state] of this.queueStates) {
      if (channelId === exceptChannelId || state.players.length === 0) continue;
      const before = state.players.length;
      state.players = state.players.filter(p => !remove.has(p));
      if (state.players.length === before) continue;
      for (const [partyId, members] of state.parties) {
        if (members.some(m => remove.has(m))) {
          state.parties.delete(partyId);
        }
      }
      state.lastUpdate = Date.now();
      queuePlayers.set(channelId, [...state.players]);
      console.log(`[QueueListener] Removed ${before - state.players.length} stale entrant(s) from queue ${this.queueLabelById(channelId)} (now in ${this.queueLabelById(exceptChannelId)})`);
    }
  }

  private async evictInGamePlayers(queueState: QueueState, channelId: string): Promise<void> {
    if (queueState.players.length === 0) return;
    const inGame = await this.findInGamePlayers(queueState.players);
    if (inGame.size === 0) return;
    const labels = await this.playerIgnMap([...inGame]);
    for (const playerId of inGame) {
      console.log(`[QueueListener] ${labels.get(playerId) ?? playerId} is in an active game, removing from queue ${this.queueLabelById(channelId)}`);
    }
    queueState.players = queueState.players.filter(p => !inGame.has(p));
    for (const [partyId, members] of queueState.parties) {
      if (members.some(m => inGame.has(m))) {
        queueState.parties.delete(partyId);
      }
    }
    queueState.lastUpdate = Date.now();
    queuePlayers.set(channelId, [...queueState.players]);
  }

  private async findInGamePlayers(discordIds: string[]): Promise<Set<string>> {
    if (discordIds.length === 0) return new Set();
    await this.ensurePlayerIgns(discordIds);
    const ignById = new Map<string, string>();
    for (const id of discordIds) {
      const ign = this.playerIgnById.get(id);
      if (ign) ignById.set(id, ign);
    }
    return findInGamePlayerIds(this.wsManager, discordIds, ignById);
  }

  private async isInBedwarsGame(ign: string): Promise<boolean> {
    return isIgnInGame(this.wsManager, ign);
  }

  private async checkPlayerStatus(ign: string): Promise<{ online: boolean | null; inGame: boolean } | null> {
    if (typeof this.wsManager.checkPlayers !== 'function') return null;
    try {
      const statuses = await this.wsManager.checkPlayers([ign]);
      return statuses.get(ign.toLowerCase()) ?? null;
    } catch {
      return null;
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

  private isMinecraftLinkOnline(): boolean {
    return typeof this.wsManager.isConnected === 'function' ? this.wsManager.isConnected() : true;
  }

  private pauseQueueWorkIfLinkOffline(context: string): boolean {
    if (this.isMinecraftLinkOnline()) {
      this.linkOfflineNotified = false;
      return false;
    }
    if (!this.linkOfflineNotified) {
      console.warn(`[QueueListener] ${context}: Minecraft link is offline, pausing queue checks and processing`);
      this.linkOfflineNotified = true;
    }
    return true;
  }

  private queueLabel(state: VoiceState): string {
    const name = state.channel?.name;
    return name ? `${name} (${state.channelId})` : `${state.channelId}`;
  }

  private queueLabelById(queueId: string): string {
    const guild = this.client.guilds.cache.first();
    const channel = guild?.channels.cache?.get(queueId) as { name?: string } | undefined;
    return channel?.name ? `${channel.name} (${queueId})` : queueId;
  }

  private async ensurePlayerIgns(ids: string[]): Promise<void> {
    const missing = ids.filter(id => !this.playerIgnById.has(id));
    if (missing.length === 0) return;
    await this.playerIgnMap(missing);
  }

  private async playerIgnMap(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const result = await resolvePlayerIgns(ids);
    for (const [id, ign] of result) {
      this.playerIgnById.set(id, ign);
    }
    return result;
  }

  private async handleQueueJoin(state: VoiceState): Promise<void> {
    if (!state.channelId) return;
    // Deliberately not holding the per-queue validation lock here: the
    // online check can take seconds and would serialize every join in the
    // queue. Validation reconciles members from the live voice channel, so an
    // in-flight join is recovered on the next tick if it is overwritten.
    await this.handleQueueJoinUnlocked(state);
  }

  private async handleQueueJoinUnlocked(state: VoiceState): Promise<void> {
    try {
      const queue = await resolveQuery<QueueLike | null>(
        Queue.findOne({ channelId: state.channelId }),
        'channelId maxPlayers minElo maxElo isActive isRanked isPicking queueType bypassRoles'
      );
      if (!queue || queue.isActive === false) {
        console.log(`[QueueListener] Join rejected for ${state.member?.id ?? 'unknown'}: queue ${this.queueLabel(state)} is missing or disabled`);
        await this.moveToWaiting(state, 'This queue is currently disabled.');
        return;
      }

      const userId = state.member?.id;
      if (!userId) return;
      console.log(`[QueueListener] Join check started for ${userId} in ${this.queueLabel(state)}`);

      const user = await resolveQuery<Pick<IUser, 'discordId' | 'ign' | 'partyId' | 'elo' | 'isBanned' | 'isFrozen'> | null>(
        User.findOne({ discordId: userId }),
        'discordId ign partyId elo isBanned isFrozen'
      );
      if (!user) {
        console.log(`[QueueListener] Join rejected for ${userId}: not registered`);
        await this.moveToWaiting(state, 'you are not registered. Please register to participate. Maybe `/update`?');
        return;
      }

      if (!user.ign) {
        console.log(`[QueueListener] Join rejected for ${userId}: no IGN configured`);
        await this.moveToWaiting(state, "you don't have a valid IGN. Please update your profile.");
        return;
      }

      if (user.isBanned || user.isFrozen) {
        console.log(`[QueueListener] Join rejected for ${user.ign}: banned or frozen`);
        await this.moveToWaiting(state, 'you have a restricted role. please contact a staff if you think its a mistake');
        return;
      }

      const member = state.member;
      if (!member) {
        console.log(`[QueueListener] Join rejected for ${user.ign}: member missing from voice state`);
        return;
      }

      const hasBypassRole = queue.bypassRoles.some((roleId: string) => member.roles.cache.has(roleId));

      if (!hasBypassRole && (user.elo < queue.minElo || user.elo > queue.maxElo)) {
        console.log(`[QueueListener] Join rejected for ${user.ign}: ELO ${user.elo} outside ${queue.minElo}-${queue.maxElo}`);
        await this.moveToWaiting(state, `ELO ${user.elo} not in range (${queue.minElo}-${queue.maxElo})`);
        return;
      }

      const presence = PresenceService.evaluate(user.ign);
      if (presence === 'offline') {
        console.log(`[QueueListener] Join rejected for ${user.ign}: presence is offline`);
        await this.moveToWaiting(state, `Player is not online, Please make sure to be on \`${config.serverip}\` Minecraft server before joining a queue!`);
        return;
      }

      const liveStatus = await this.checkPlayerStatus(user.ign);
      if (presence === 'unknown') {
        if (!this.isMinecraftLinkOnline()) {
          console.log(`[QueueListener] Join rejected for ${user.ign}: cannot verify presence while the Minecraft link is offline`);
          await this.moveToWaiting(state, 'Could not verify your Minecraft presence because the server link is offline. Please try again shortly.');
          return;
        }
        if (liveStatus?.online !== null && liveStatus?.online !== undefined) {
          PresenceService.ingest(user.ign, liveStatus.online);
          if (!liveStatus.online) {
            console.log(`[QueueListener] Join rejected for ${user.ign}: online check returned offline`);
            await this.moveToWaiting(state, `Player is not online, Please make sure to be on \`${config.serverip}\` Minecraft server before joining a queue!`);
            return;
          }
        } else {
          try {
            const onlineCheck = await this.wsManager.checkPlayerOnline(user.ign, 2000);
            if (onlineCheck.online !== true) {
              PresenceService.ingest(user.ign, false);
              console.log(`[QueueListener] Join rejected for ${user.ign}: online check returned ${onlineCheck.online === null ? 'no response' : 'offline'}`);
              await this.moveToWaiting(state, `Player is not online, Please make sure to be on \`${config.serverip}\` Minecraft server before joining a queue!`);
              return;
            }
            PresenceService.ingest(user.ign, true);
            console.log(`[QueueListener] Online check passed for ${user.ign}`);
          } catch (error) {
            PresenceService.ingest(user.ign, false);
            console.warn(`[QueueListener] Could not check online status for ${user.ign}, rejecting queue join: ${error}`);
            await this.moveToWaiting(state, 'Could not verify your Minecraft presence. Please try again shortly.');
            return;
          }
        }
      }
      this.playerIgnById.set(userId, user.ign);

      const currentVoiceChannel = state.member?.voice?.channelId;
      if (currentVoiceChannel && currentVoiceChannel !== state.channelId) {
        console.log(`[QueueListener] Ignoring stale join for ${userId}; they already left ${state.channelId}`);
        return;
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
        console.log(`[QueueListener] Created queue state for ${this.queueLabel(state)}`);
      }

      if (!user.partyId) {
        const inBedwars = liveStatus?.inGame ?? await this.isInBedwarsGame(user.ign);
        if (inBedwars) {
          console.log(`[QueueListener] Join rejected for ${user.ign}: already in a BedWars game`);
          await this.moveToWaiting(state, 'You are already in a BedWars game. Finish it before joining the queue.');
          return;
        }
        this.removeFromOtherQueues([userId], queue.channelId);
      }

      await this.evictInGamePlayers(queueState, queue.channelId);

      const wasQueueFull = queueState.players.length >= queue.maxPlayers;
      const wasQueued = queueState.players.includes(userId);

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

      if (!user.partyId && !wasQueued) {
        console.log(`[QueueListener] ${user.ign} joined queue ${this.queueLabel(state)} (${queueState.players.length}/${queue.maxPlayers})`);
      } else if (!user.partyId && wasQueued) {
        console.log(`[QueueListener] ${user.ign} is already in queue ${this.queueLabel(state)}, ignoring duplicate join`);
      }

      const isQueueFull = queueState.players.length >= queue.maxPlayers;

      if (isQueueFull && !wasQueueFull) {
        console.log(`[QueueListener] Queue ${this.queueLabel(state)} just became full, scheduling processing`);
        await this.scheduleQueueProcessing(queue.channelId);
      }

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueJoin:', error);
      await this.moveToWaiting(state, 'Internal error');
    }
  }

  private async handlePartyJoin(
    state: VoiceState,
    user: { partyId?: string | null; ign?: string },
    queueState: QueueState,
    queue: QueueLike
  ): Promise<{ success: boolean }> {
    try {
      const partyId = user.partyId;
      if (!partyId) {
        console.log(`[QueueListener] Party join rejected for ${user.ign ?? state.member?.id ?? 'unknown'}: no party id`);
        await this.moveToWaiting(state, 'Invalid party');
        return { success: false };
      }

      let partyMembers: string[];
      const party = await resolveQuery<{ partyId: string; members?: string[] } | null>(
        Party.findOne({ partyId }),
        'partyId members'
      );
      if (party && party.members) {
        partyMembers = party.members;
        this.partyCache.set(partyId, {
          members: partyMembers,
          timestamp: Date.now()
        });
        console.log(`[QueueListener] Party ${partyId} loaded with ${partyMembers.length} member(s) for ${this.queueLabel(state)}`);
      } else {
        console.log(`[QueueListener] Party ${partyId} not found for ${user.ign ?? state.member?.id ?? 'unknown'}`);
        await this.moveToWaiting(state, 'Invalid party');
        return { success: false };
      }

      const isValidPartySize = await this.validatePartySize(state, partyMembers, queue);
      if (!isValidPartySize) {
        console.log(`[QueueListener] Party ${partyId} failed party-size validation for ${this.queueLabel(state)}`);
        return { success: false };
      }

      const partyUsersPromise = User.find({
        discordId: { $in: partyMembers }
      }).select('discordId ign elo isBanned isFrozen').lean();

      const partyUsers = await partyUsersPromise;

      if (partyUsers.length !== partyMembers.length) {
        console.log(`[QueueListener] Party ${partyId} rejected: ${partyMembers.length - partyUsers.length} member(s) not found in database`);
        await this.moveToWaiting(state, 'Some party members not found');
        return { success: false };
      }

      const partyIgns = partyUsers
        .map(member => member.ign)
        .filter((ign): ign is string => Boolean(ign));
      if (typeof this.wsManager.checkBedwarsPlayers === 'function') {
        const bedwarsStatuses = await this.wsManager.checkBedwarsPlayers(partyIgns);
        const inBedwars = partyUsers.find(member => member.ign && bedwarsStatuses.get(member.ign.toLowerCase()) === true);
        if (inBedwars?.ign) {
          console.log(`[QueueListener] Party ${partyId} rejected: ${inBedwars.ign} is already in a BedWars game`);
          await this.moveToWaiting(state, `Party member ${inBedwars.ign} is already in a BedWars game`);
          return { success: false };
        }
      }

      for (const member of partyUsers) {
        if (member.ign) this.playerIgnById.set(member.discordId, member.ign);
        if (member.isBanned || member.isFrozen) {
          console.log(`[QueueListener] Party ${partyId} rejected: a member is banned or frozen`);
          await this.moveToWaiting(state, `Party member is banned or frozen`);
          return { success: false };
        }

        if (member.elo < queue.minElo || member.elo > queue.maxElo) {
          console.log(`[QueueListener] Party ${partyId} rejected: member ELO ${member.elo} outside ${queue.minElo}-${queue.maxElo}`);
          await this.moveToWaiting(state, `Party member ELO not in queue range`);
          return { success: false };
        }
      }

      const guild = this.client.guilds.cache.first();
      if (!guild) {
        console.warn(`[QueueListener] Party ${partyId} rejected: no guild available`);
        return { success: false };
      }

      const voiceChannel = guild.channels.cache?.get(queue.channelId) ?? await guild.channels.fetch(queue.channelId).catch(() => null);
      if (!voiceChannel || !voiceChannel.isVoiceBased()) {
        console.warn(`[QueueListener] Party ${partyId} rejected: queue voice channel ${queue.channelId} is missing or invalid`);
        return { success: false };
      }

      const playersInVC = new Set(voiceChannel.members.keys());
      const membersInVC = partyMembers.filter(memberId => playersInVC.has(memberId));

      if (membersInVC.length !== partyMembers.length) {
        console.log(`[QueueListener] Party ${partyId}: waiting for ${partyMembers.length - membersInVC.length} member(s) to join queue ${this.queueLabel(state)}`);
        return { success: false };
      }

      queueState.parties.set(partyId, partyMembers);
      this.removeFromOtherQueues(partyMembers, queue.channelId);

      for (const memberId of partyMembers) {
        if (!queueState.players.includes(memberId)) {
          queueState.players.push(memberId);
        }
      }

      console.log(`[QueueListener] ${user.ign ?? state.member?.id ?? 'Player'} joined queue ${this.queueLabel(state)} with party ${partyId} (${partyMembers.length} members, ${queueState.players.length}/${queue.maxPlayers})`);

      return { success: true };

    } catch (error) {
      console.error('[QueueListener] Error in handlePartyJoin:', error);
      await this.moveToWaiting(state, 'Party join error');
      return { success: false };
    }
  }

  private async handleQueueLeave(state: VoiceState): Promise<void> {
    if (!state.channelId) return;
    await this.handleQueueLeaveUnlocked(state);
  }

  private async handleQueueLeaveUnlocked(state: VoiceState): Promise<void> {
    try {
      const queue = await resolveQuery<QueueLike | null>(
        Queue.findOne({ channelId: state.channelId }),
        'channelId maxPlayers isActive'
      );
      if (!queue || queue.isActive === false) {
        console.log(`[QueueListener] Leave check skipped for ${state.member?.id ?? 'unknown'}: queue ${this.queueLabel(state)} is missing or disabled`);
        return;
      }

      const userId = state.member?.id;
      if (!userId) return;

      const user = await resolveQuery<Pick<IUser, 'discordId' | 'partyId' | 'ign'> | null>(
        User.findOne({ discordId: userId }),
        'discordId partyId ign'
      );
      if (!user) {
        console.log(`[QueueListener] Leave check skipped for ${userId}: user not registered`);
        return;
      }

      const queueState = this.queueStates.get(queue.channelId);
      if (!queueState) {
        console.log(`[QueueListener] Leave check skipped for ${user.ign ?? userId}: no queue state for ${this.queueLabel(state)}`);
        return;
      }

      const wasQueueFull = queueState.players.length >= queue.maxPlayers;
      const playerLabel = user.ign ?? userId;
      const queueLabel = this.queueLabel(state);

      let partyId = user.partyId ?? null;
      let partyMembers = partyId ? queueState.parties.get(partyId) : undefined;

      // The user's current party id can change while they are queued, and a
      // stale solo join may not have a party entry at all. Find the party by
      // membership as a fallback so the whole group leaves together.
      if (!partyMembers) {
        for (const [candidateId, members] of queueState.parties) {
          if (members.includes(userId)) {
            partyId = candidateId;
            partyMembers = members;
            break;
          }
        }
      }

      if (partyId && partyMembers) {
        await updatePartyActivity(partyId);

        queueState.players = queueState.players.filter(p => !partyMembers!.includes(p));
        queueState.parties.delete(partyId);
        console.log(`[QueueListener] Party ${partyId} (${partyMembers.length} members) left queue ${queueLabel} after ${playerLabel} left (${queueState.players.length}/${queue.maxPlayers})`);
      } else {

        queueState.players = queueState.players.filter(p => p !== userId);
        console.log(`[QueueListener] ${playerLabel} left queue ${queueLabel} (${queueState.players.length}/${queue.maxPlayers})`);
      }

      queueState.lastUpdate = Date.now();
      queuePlayers.set(queue.channelId, [...queueState.players]);

      const isQueueFull = queueState.players.length >= queue.maxPlayers;

      console.log(`[QueueListener] Queue ${queueLabel}: ${queueState.players.length}/${queue.maxPlayers} players remaining`);


      if (wasQueueFull && !isQueueFull) {
        console.log(`[QueueListener] Queue ${queueLabel} is no longer full, stopping processing`);
        this.cancelQueueProcessing(queue.channelId);
      }

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueLeave:', error);
    }
  }

  private async handleQueueSwitch(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      console.log(`[QueueListener] Queue switch for ${newState.member?.id ?? 'unknown'}: ${this.queueLabel(oldState)} -> ${this.queueLabel(newState)}`);
      await this.handleQueueLeave(oldState);


      await this.handleQueueJoin(newState);

    } catch (error) {
      console.error('[QueueListener] Error in handleQueueSwitch:', error);
    }
  }

  private async scheduleQueueProcessing(queueId: string): Promise<void> {
    try {
      if (this.pauseQueueWorkIfLinkOffline(`Processing ${queueId}`)) return;

      this.cancelQueueProcessing(queueId);

      const queueState = this.queueStates.get(queueId);
      if (!queueState) {
        console.log(`[QueueListener] Cannot schedule processing for ${queueId}: no queue state`);
        return;
      }
      if (queueState.processing) {
        console.log(`[QueueListener] Queue ${this.queueLabelById(queueId)} is already processing, not scheduling again`);
        return;
      }

      queueState.processing = true;
      console.log(`[QueueListener] Scheduling processing for ${this.queueLabelById(queueId)} in 1s (${queueState.players.length} players, ${queueState.parties.size} parties)`);

      const timeout = setTimeout(async () => {
        if (this.shuttingDown) return;
        try {
          console.log(`[QueueListener] Starting processing for ${this.queueLabelById(queueId)}`);
          await this.matchmaker.processQueue(queueId);
          console.log(`[QueueListener] Processing finished for ${this.queueLabelById(queueId)}`);
        } catch (error) {
          console.error(`[QueueListener] Error processing queue ${queueId}:`, error);
        } finally {
          const state = this.queueStates.get(queueId);
          if (state) {
            state.processing = false;
            console.log(`[QueueListener] Queue ${this.queueLabelById(queueId)} after processing: ${state.players.length} players, ${state.parties.size} parties`);
          }
          this.processingLocks.delete(queueId);
          if (!this.shuttingDown) {
            await this.validateQueueState(queueId);
          }
        }
      }, 1000);
      timeout.unref?.();

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
      console.log(`[QueueListener] Cancelled scheduled processing for ${this.queueLabelById(queueId)}`);
    }
  }

  private async moveToWaiting(state: VoiceState, reason: string): Promise<void> {
    try {
      const member = state.member;
      if (!member) return;


      const waitingVcId = config.voicechannels.waitingvc;
      if (waitingVcId && member.voice.channelId !== waitingVcId) {
        await this.workersManager.moveMembers([member.id], waitingVcId, 8);
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

      console.warn(`[QueueListener] ${member.user.username} moved to waiting from ${this.queueLabel(state)} due to: ${reason}`);
    } catch (error) {
      console.error('[QueueListener] Error moving to waiting:', error);
    }
  }

  private async validatePartySize(state: VoiceState, partyMembers: string[], queue: QueueLike): Promise<boolean> {
    try {
      const member = state.member;
      if (!member) return false;

      const partySize = partyMembers.length;
      const roles = {
        [config.roles.partyof2Queue]: 2,
        [config.roles.partyof3Queue]: 3,
        [config.roles.partyof4Queue]: 4
      };

      const roleSizes = Object.entries(roles)
        .filter(([roleId]) => member.roles.cache.has(roleId))
        .map(([, size]) => size);
      const highestAllowedSize = maxPartySizeForQueue(queue, roleSizes);

      if (partySize > highestAllowedSize) {
        console.log(`[QueueListener] Party size check failed for ${partySize} member(s) in ${this.queueLabelById(queue.channelId)} (max ${highestAllowedSize})`);
        await this.moveToWaiting(state, `Party too large (${partySize} > ${highestAllowedSize})`);
        return false;
      }

      console.log(`[QueueListener] Party size check passed for ${partySize} member(s) in ${this.queueLabelById(queue.channelId)} (max ${highestAllowedSize})`);
      return true;
    } catch (error) {
      console.error('[QueueListener] Error validating party size:', error);
      return false;
    }
  }

  public cleanup(): void {
    try {
      this.shuttingDown = true;

      for (const timeout of this.processingLocks.values()) {
        clearTimeout(timeout);
      }
      this.processingLocks.clear();

      if (this.cacheCleanupInterval) {
        clearInterval(this.cacheCleanupInterval);
        this.cacheCleanupInterval = null;
      }
      if (this.queueMonitorInterval) {
        clearInterval(this.queueMonitorInterval);
        this.queueMonitorInterval = null;
      }
      if (this.presenceSweepInterval) {
        clearInterval(this.presenceSweepInterval);
        this.presenceSweepInterval = null;
      }
      if (this.queueStatusInterval) {
        clearInterval(this.queueStatusInterval);
        this.queueStatusInterval = null;
      }
      if (this.initialPresenceSweep) {
        clearTimeout(this.initialPresenceSweep);
        this.initialPresenceSweep = null;
      }


      this.queueStates.clear();
      this.partyCache.clear();
      this.playerLocks.clear();
      this.queueLocks.clear();
      this.queueStatusCache.clear();
      this.playerIgnById.clear();
      this.queueMonitorRunning = false;
      this.presenceSweepRunning = false;

      this.matchmaker.cleanup();
      console.log('[QueueListener] Cleanup completed');
    } catch (error) {
      console.error('[QueueListener] Error during cleanup:', error);
    }
  }
}
