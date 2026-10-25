import { Client } from 'discord.js';
import Queue from '../models/Queue';
import User from '../models/User';
import { QueueType, MatchmakingResult, QueueProcessingResult } from '../types/GameTypes';
import { GameManager } from './GameManager';
import { RandomQueueManager } from './RandomQueueManager';
import { PickingQueueManager } from './PickingQueueManager';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { queuePlayers } from '../types/queuePlayersMemory';
import { PresenceService } from '../services/PresenceService';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

interface ProcessingState {
  isProcessing: boolean;
  lastProcessed: number;
  retryCount: number;
  errors: string[];
  priority: number;
}

interface QueueMetrics {
  processedCount: number;
  successCount: number;
  errorCount: number;
  averageProcessingTime: number;
  lastProcessedAt: number;
}

interface QueueLike {
  id?: unknown;
  channelId: string;
  maxPlayers: number;
  minElo: number;
  maxElo: number;
  isRanked?: boolean;
  isPicking?: boolean;
  queueType?: string;
  bypassRoles: string[];
}

interface ValidatedUserDoc {
  discordId: string;
  partyId?: string | null;
  ign?: string;
  isBanned?: boolean;
  isFrozen?: boolean;
  elo?: number;
}

interface ValidatedPartyDoc {
  partyId: string;
  members?: string[];
}

interface ValidationCtx {
  userMap: Map<string, ValidatedUserDoc>;
  partyMap: Map<string, ValidatedPartyDoc>;
  partyMemberMap: Map<string, ValidatedUserDoc>;
}

async function resolveLean<T>(query: unknown): Promise<T> {
  const q = query as { lean?: () => Promise<T> };
  if (typeof q.lean === 'function') return q.lean();
  return query as Promise<T>;
}

export class CentralizedMatchmaker {
  private client: Client;
  private wsManager: WebSocketManager;
  private gameManager: GameManager;
  private randomQueueManager: RandomQueueManager;
  private pickingQueueManager: PickingQueueManager;
  

  
  private processingStates: Map<string, ProcessingState> = new Map();
  private processingLocks: Map<string, NodeJS.Timeout> = new Map();
  private retryQueue: Set<string> = new Set();
  private queueMetrics: Map<string, QueueMetrics> = new Map();
  private priorityQueue: Array<{ queueId: string; priority: number; timestamp: number }> = [];
  private queueCache: Map<string, { queue: QueueLike; timestamp: number }> = new Map();
  private validationCache: Map<string, { valid: boolean; timestamp: number }> = new Map();
  private queueMonitorInterval: NodeJS.Timeout | null = null;
  private cacheCleanupInterval: NodeJS.Timeout | null = null;

  
  private readonly MAX_CONCURRENT_GAMES = 100;
  private readonly PROCESSING_DELAY = 1000; 
  private readonly LOCK_TIMEOUT = 15000; 
  private readonly MAX_RETRIES = 3; 
  private readonly RETRY_DELAY = 2000; 
  private readonly QUEUE_MONITOR_INTERVAL = 2000; 
  private readonly PRIORITY_THRESHOLD = 10;
  private readonly CACHE_TTL = 30000;
  private readonly VALIDATION_CACHE_TTL = 5000;
  private readonly MAX_QUEUE_SIZE = 10000; 

  constructor(client: Client, wsManager: WebSocketManager, gameManager: GameManager) {
    this.client = client;
    this.wsManager = wsManager;
    this.gameManager = gameManager;
    this.randomQueueManager = new RandomQueueManager(client, gameManager, wsManager);
    this.pickingQueueManager = new PickingQueueManager(client, gameManager, wsManager);
    this.startQueueMonitor();
    this.initializeMetrics();
    this.startCacheCleanup();
    console.log('[CentralizedMatchmaker] Initialized ');
  }

  private initializeMetrics(): void {
    Queue.find({ isActive: true }).then(queues => {
      queues.forEach(queue => {
        this.queueMetrics.set(queue.channelId, {
          processedCount: 0,
          successCount: 0,
          errorCount: 0,
          averageProcessingTime: 0,
          lastProcessedAt: Date.now()
        });
      });
    }).catch(error => {
      console.error('[CentralizedMatchmaker] Error initializing metrics:', error);
    });
  }

  private async getPresentMembers(queueId: string): Promise<Set<string> | null> {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) return null;
      const channel = await guild.channels.fetch(queueId).catch(() => null);
      if (!channel || !channel.isVoiceBased()) return null;
      return new Set(channel.members.keys());
    } catch {
      return null;
    }
  }

  private startCacheCleanup(): void {
    this.cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [key, cache] of this.queueCache.entries()) {
        if (now - cache.timestamp > this.CACHE_TTL) {
          this.queueCache.delete(key);
        }
      }
      
      for (const [key, cache] of this.validationCache.entries()) {
        if (now - cache.timestamp > this.VALIDATION_CACHE_TTL) {
          this.validationCache.delete(key);
        }
      }
    }, 15000);
  }

  private startQueueMonitor(): void {
    this.queueMonitorInterval = setInterval(async () => {
      await this.monitorQueues();
    }, this.QUEUE_MONITOR_INTERVAL);
  }

  private async monitorQueues(): Promise<void> {
    try {
      const queues = await Queue.find({ isActive: true }).lean();
      const now = Date.now();

      this.processPriorityQueue();

      const checkPromises = queues.map(async (queue) => {
        try {
          const players = queuePlayers.get(queue.channelId) || [];
          
          if (players.length > this.MAX_QUEUE_SIZE) {
            console.warn(`[CentralizedMatchmaker] Queue ${queue.channelId} exceeded max size (${players.length}), limiting to ${this.MAX_QUEUE_SIZE}`);
            queuePlayers.set(queue.channelId, players.slice(0, this.MAX_QUEUE_SIZE));
            return;
          }

          const state = this.processingStates.get(queue.channelId);
          const metrics = this.getOrCreateMetrics(queue.channelId);

          const priority = this.calculateQueuePriority(players.length, queue.maxPlayers, metrics.lastProcessedAt);

          if (players.length >= queue.maxPlayers && (!state || !state.isProcessing)) {
            if (priority >= this.PRIORITY_THRESHOLD) {
              this.addToPriorityQueue(queue.channelId, priority);
            } else {
              this.scheduleQueueProcessing(queue.channelId, false);
            }
          }

          if (state && state.isProcessing && now - state.lastProcessed > this.LOCK_TIMEOUT) {
            const isPicking = queue.isPicking ?? (queue as unknown as { ispicking?: boolean }).ispicking;
            const pickingGraceMs = this.LOCK_TIMEOUT * 3;
            if (isPicking && now - state.lastProcessed <= pickingGraceMs) {
              return;
            }
            console.warn(`[CentralizedMatchmaker] Queue ${queue.channelId} stuck for ${now - state.lastProcessed}ms, resetting`);
            this.resetProcessingState(queue.channelId);
            metrics.errorCount++;
          }

          if (now - metrics.lastProcessedAt > 300000) {
            this.cleanupOldMetrics(queue.channelId);
          }
        } catch (queueError) {
          console.error(`[CentralizedMatchmaker] Error monitoring queue ${queue.channelId}:`, queueError);
        }
      });

      await Promise.allSettled(checkPromises);
    } catch (error) {
      console.error('[CentralizedMatchmaker] Error in queue monitor:', error);
    }
  }

  private calculateQueuePriority(playerCount: number, maxPlayers: number, lastProcessed: number): number {
    if (maxPlayers === 0) return 0;
    
    const fillRatio = Math.min(playerCount / maxPlayers, 1);
    const waitTime = Date.now() - lastProcessed;
    const waitBonus = Math.min(waitTime / 60000, 5);

    return Math.floor(fillRatio * 10 + waitBonus);
  }

  private addToPriorityQueue(queueId: string, priority: number): void {
    this.priorityQueue = this.priorityQueue.filter(item => item.queueId !== queueId);

    this.priorityQueue.push({ queueId, priority, timestamp: Date.now() });

    if (this.priorityQueue.length > 100) {
      this.priorityQueue = this.priorityQueue.slice(0, 100);
    }

    this.priorityQueue.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.timestamp - b.timestamp;
    });
  }

  private processPriorityQueue(): void {
    if (this.priorityQueue.length === 0) return;

    const highPriorityItem = this.priorityQueue.shift();
    if (highPriorityItem) {
      console.log(`[CentralizedMatchmaker] Processing high priority queue: ${highPriorityItem.queueId} (priority: ${highPriorityItem.priority})`);
      this.scheduleQueueProcessing(highPriorityItem.queueId, true);
    }
  }

  private getOrCreateMetrics(queueId: string): QueueMetrics {
    let metrics = this.queueMetrics.get(queueId);
    if (!metrics) {
      metrics = {
        processedCount: 0,
        successCount: 0,
        errorCount: 0,
        averageProcessingTime: 0,
        lastProcessedAt: Date.now()
      };
      this.queueMetrics.set(queueId, metrics);
    }
    return metrics;
  }

  private cleanupOldMetrics(queueId: string): void {
    const metrics = this.queueMetrics.get(queueId);
    if (metrics) {
      
      metrics.processedCount = Math.floor(metrics.processedCount * 0.8);
      metrics.successCount = Math.floor(metrics.successCount * 0.8);
      metrics.errorCount = Math.floor(metrics.errorCount * 0.8);
    }
  }

  public async processQueue(queueId: string): Promise<MatchmakingResult> {
    const startTime = Date.now();
    const state = this.getOrCreateProcessingState(queueId);
    const metrics = this.getOrCreateMetrics(queueId);

    if (state.isProcessing) {
      console.log(`[CentralizedMatchmaker] Queue ${queueId} already being processed`);
      return { success: false, gamesCreated: 0, errors: ['Queue already being processed'] };
    }

    const activeGames = this.gameManager.getActiveGameCount();
    const gameBuffer = Math.max(5, Math.floor(this.MAX_CONCURRENT_GAMES * 0.1));
    if (activeGames >= this.MAX_CONCURRENT_GAMES - gameBuffer) {
      console.warn(`[CentralizedMatchmaker] Near capacity: ${activeGames}/${this.MAX_CONCURRENT_GAMES} games (buffer: ${gameBuffer})`);
      return { success: false, gamesCreated: 0, errors: ['Server near capacity'] };
    }

    state.isProcessing = true;
    state.lastProcessed = Date.now();

    const errors: string[] = [];
    let gamesCreated = 0;

    try {
      const queue = await this.getQueueSafely(queueId);
      if (!queue) {
        errors.push(`Queue ${queueId} not found or inactive`);
        return { success: false, gamesCreated: 0, errors };
      }

      const players = queuePlayers.get(queueId) || [];
      state.priority = this.calculateQueuePriority(players.length, queue.maxPlayers, metrics.lastProcessedAt);

      if (players.length < queue.maxPlayers) {
        return { success: true, gamesCreated: 0 };
      }

      let validPlayers: string[];
      try {
        validPlayers = await withTimeout(this.validatePlayers(players, queue), 5000, 'Validation');
      } catch (validationError) {
        console.warn(`[CentralizedMatchmaker] Player validation failed for ${queueId}:`, validationError);
        return { success: false, gamesCreated: 0, errors: ['Player validation timed out'] };
      }

      if (validPlayers.length !== players.length) {
        const currentQueuePlayers = queuePlayers.get(queueId) || [];
        const snapshotSet = new Set(players);
        const joinedDuringValidation = currentQueuePlayers.filter(p => !snapshotSet.has(p));
        queuePlayers.set(queueId, [...validPlayers, ...joinedDuringValidation]);
      }

      const present = await this.getPresentMembers(queueId);
      if (present) {
        const before = validPlayers.length;
        validPlayers = validPlayers.filter(p => present.has(p));
        if (validPlayers.length !== before) {
          console.log(`[CentralizedMatchmaker] Dropped ${before - validPlayers.length} player(s) who left queue ${queueId} during validation`);
        }
        queuePlayers.set(queueId, (queuePlayers.get(queueId) || []).filter(p => present.has(p)));
      }

      if (validPlayers.length < queue.maxPlayers) {
        return { success: true, gamesCreated: 0 };
      }

      const queueType = this.determineQueueType(queue);
      const maxPossibleGames = Math.floor(validPlayers.length / queue.maxPlayers);
      const capacityLimit = this.MAX_CONCURRENT_GAMES - activeGames - gameBuffer;
      const maxGamesForThisQueue = Math.min(maxPossibleGames, capacityLimit, 10);

      if (maxGamesForThisQueue <= 0) {
        return { success: true, gamesCreated: 0 };
      }

      const isPickingQueue = queueType === QueueType.PICKING;
      if (((queue.isPicking ?? (queue as unknown as { ispicking?: boolean }).ispicking) || queue.queueType === 'picking') && queue.maxPlayers <= 2) {
        console.log(`[CentralizedMatchmaker] Using random queue for ${queue.maxPlayers}-player game (overriding picking mode)`);
      }

      const processingPromise: Promise<QueueProcessingResult> = isPickingQueue
        ? this.pickingQueueManager.processQueue(validPlayers, queue, maxGamesForThisQueue)
        : this.randomQueueManager.processQueue(validPlayers, queue, maxGamesForThisQueue);

      let processingResult: QueueProcessingResult;
      try {
        processingResult = isPickingQueue
          ? await withTimeout(processingPromise, 120000, 'Picking')
          : await withTimeout(processingPromise, 30000, 'Processing');
      } catch (processingError) {
        const processingMessage = processingError instanceof Error ? processingError.message : String(processingError);
        console.error(`[CentralizedMatchmaker] Processing error for ${queueId}:`, processingError);
        errors.push(`Processing failed: ${processingMessage}`);

        state.retryCount++;
        state.errors.push(processingMessage);

        if (state.retryCount < this.MAX_RETRIES) {
          console.log(`[CentralizedMatchmaker] Scheduling retry ${state.retryCount}/${this.MAX_RETRIES} for queue ${queueId}`);
          this.scheduleRetry(queueId);
        } else {
          console.error(`[CentralizedMatchmaker] Max retries exceeded for queue ${queueId}`);
          errors.push('Max retries exceeded');
          state.priority = Math.max(0, state.priority - 5);
        }

        metrics.errorCount++;
        return { success: false, gamesCreated: 0, errors };
      }

      gamesCreated = processingResult.gamesCreated;

      if (gamesCreated > 0) {
        const usedPlayers = new Set(processingResult.usedPlayers);
        const currentQueuePlayers = queuePlayers.get(queueId) || [];
        const snapshotSet = new Set(validPlayers);
        const presentAfter = await this.getPresentMembers(queueId);
        const stillPresent = (p: string) => !presentAfter || presentAfter.has(p);
        const joinedDuringProcessing = currentQueuePlayers.filter(p => !snapshotSet.has(p) && stillPresent(p));
        const remainingPlayers = validPlayers.filter(p => !usedPlayers.has(p) && stillPresent(p));
        queuePlayers.set(queueId, [...remainingPlayers, ...joinedDuringProcessing]);
      }

      state.retryCount = 0;
      state.errors = [];
      metrics.successCount++;

      if (gamesCreated > 0 && (queuePlayers.get(queueId)?.length || 0) >= queue.maxPlayers) {
        const delay = gamesCreated > 1 ? this.PROCESSING_DELAY * 1.5 : this.PROCESSING_DELAY;
        setTimeout(() => {
          this.scheduleQueueProcessing(queueId, false);
        }, delay);
      }

      return {
        success: true,
        gamesCreated,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error(`[CentralizedMatchmaker] Unexpected error processing queue ${queueId}:`, error);
      const errorMessage = error instanceof Error && error.message ? error.message : 'Unexpected error occurred';
      errors.push(errorMessage);

      state.retryCount++;
      state.errors.push(error instanceof Error ? error.message : 'Unexpected error occurred');
      metrics.errorCount++;

      if (state.retryCount < this.MAX_RETRIES) {
        this.scheduleRetry(queueId);
      }

      return { success: false, gamesCreated, errors };

    } finally {
      const processingTime = Date.now() - startTime;
      state.isProcessing = false;
      state.lastProcessed = Date.now();

      metrics.processedCount++;
      metrics.lastProcessedAt = Date.now();
      metrics.averageProcessingTime = (metrics.averageProcessingTime * (metrics.processedCount - 1) + processingTime) / metrics.processedCount;

      console.log(`[CentralizedMatchmaker] Queue ${queueId} processed in ${processingTime}ms (avg: ${Math.round(metrics.averageProcessingTime)}ms)`);
    }
  }

  private scheduleRetry(queueId: string): void {
    if (this.retryQueue.has(queueId)) return;

    this.retryQueue.add(queueId);
    setTimeout(() => {
      this.retryQueue.delete(queueId);
      this.scheduleQueueProcessing(queueId, false);
    }, this.RETRY_DELAY);
  }

  public scheduleQueueProcessing(queueId: string, immediate: boolean = false): void {
    try {
      const existingTimeout = this.processingLocks.get(queueId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const delay = immediate ? 100 : this.PROCESSING_DELAY;
      const timeout = setTimeout(async () => {
        try {
          await this.processQueue(queueId);
        } catch (error) {
          console.error(`[CentralizedMatchmaker] Error in scheduled processing for ${queueId}:`, error);
        } finally {
          this.processingLocks.delete(queueId);
        }
      }, delay);

      this.processingLocks.set(queueId, timeout);

    } catch (error) {
      console.error(`[CentralizedMatchmaker] Error scheduling queue processing for ${queueId}:`, error);
    }
  }

  private getOrCreateProcessingState(queueId: string): ProcessingState {
    let state = this.processingStates.get(queueId);
    if (!state) {
      state = {
        isProcessing: false,
        lastProcessed: 0,
        retryCount: 0,
        errors: [],
        priority: 0
      };
      this.processingStates.set(queueId, state);
    }
    return state;
  }

  private resetProcessingState(queueId: string): void {
    const state = this.processingStates.get(queueId);
    if (state) {
      state.isProcessing = false;
      state.retryCount = 0;
      state.errors = [];
    }

    const timeout = this.processingLocks.get(queueId);
    if (timeout) {
      clearTimeout(timeout);
      this.processingLocks.delete(queueId);
    }
  }

  private async validatePlayers(playerIds: string[], queue: QueueLike): Promise<string[]> {
    try {
      const validFlags = new Array<boolean>(playerIds.length).fill(false);
      const pendingIndexes: number[] = [];

      for (let i = 0; i < playerIds.length; i++) {
        const cacheKey = `${queue.channelId}:${playerIds[i]}`;
        const cached = this.validationCache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.VALIDATION_CACHE_TTL) {
          validFlags[i] = cached.valid;
        } else {
          pendingIndexes.push(i);
        }
      }

      if (pendingIndexes.length === 0) {
        return playerIds.filter((_, i) => validFlags[i]);
      }

      const pendingIds = pendingIndexes.map(i => playerIds[i]);

      let userDocs: ValidatedUserDoc[] = [];
      try {
        userDocs = (await resolveLean<ValidatedUserDoc[]>(User.find({ discordId: { $in: pendingIds } }))) ?? [];
      } catch (error) {
        console.error('[CentralizedMatchmaker] Error batch-fetching users for validation:', error);
        userDocs = [];
      }
      const userMap = new Map<string, ValidatedUserDoc>(userDocs.map(u => [u.discordId, u]));

      const partyIds = [...new Set(userDocs.map(u => u.partyId).filter(Boolean))];
      const partyMap = new Map<string, ValidatedPartyDoc>();
      if (partyIds.length > 0) {
        try {
          const Party = (await import('../models/Party')).default as unknown as {
            find: (filter: unknown) => unknown;
            findOne: (filter: unknown) => unknown;
          };
          if (typeof Party?.find === 'function') {
            const partyDocs = (await resolveLean<ValidatedPartyDoc[]>(Party.find({ partyId: { $in: partyIds } }))) ?? [];
            for (const party of partyDocs ?? []) {
              partyMap.set(party.partyId, party);
            }
          } else {
            const results = await Promise.all(partyIds.map(async pid => {
              try {
                return await resolveLean<ValidatedPartyDoc | null>(Party.findOne({ partyId: pid }));
              } catch {
                return null;
              }
            }));
            for (const party of results) {
              if (party) partyMap.set(party.partyId, party);
            }
          }
        } catch (error) {
          console.error('[CentralizedMatchmaker] Error batch-fetching parties for validation:', error);
        }
      }

      const queuedSet = new Set(playerIds);
      const missingMemberIds = [...new Set(
        [...partyMap.values()].flatMap(party => party.members ?? [])
      )].filter(id => !userMap.has(id) && !queuedSet.has(id));
      const partyMemberMap = new Map<string, ValidatedUserDoc>();
      if (missingMemberIds.length > 0) {
        try {
          const memberDocs = (await resolveLean<ValidatedUserDoc[]>(User.find({ discordId: { $in: missingMemberIds } }))) ?? [];
          for (const member of memberDocs ?? []) {
            partyMemberMap.set(member.discordId, member);
          }
        } catch (error) {
          console.error('[CentralizedMatchmaker] Error batch-fetching party members:', error);
        }
      }

      const ctx = { userMap, partyMap, partyMemberMap };
      const checkedParties = new Set<string>();
      const invalidParties = new Set<string>();
      const presenceTasks: Array<() => Promise<void>> = [];
      const presenceResults = new Map<string, boolean>();

      for (const index of pendingIndexes) {
        const playerId = playerIds[index];
        try {
          const outcome = this.evaluatePlayerLocal(playerId, queue, playerIds, ctx, checkedParties, invalidParties);

          if (outcome.decision === 'valid') {
            validFlags[index] = true;
            this.validationCache.set(`${queue.channelId}:${playerId}`, { valid: true, timestamp: Date.now() });
          } else if (outcome.decision === 'invalid') {
            validFlags[index] = false;
            this.validationCache.set(`${queue.channelId}:${playerId}`, { valid: false, timestamp: Date.now() });
            console.log(`[CentralizedMatchmaker] Player ${playerId} failed validation`);
          } else {
            presenceTasks.push(async () => {
              const online = await this.checkPlayerOnlinePresence(outcome.ign);
              presenceResults.set(playerId, online);
            });
          }
        } catch (error) {
          console.error(`[CentralizedMatchmaker] Error validating player ${playerId}:`, error);
          validFlags[index] = false;
        }
      }

      await this.runWithConcurrencyLimit(presenceTasks, 5);

      for (const index of pendingIndexes) {
        const playerId = playerIds[index];
        if (!presenceResults.has(playerId)) continue;
        const online = presenceResults.get(playerId)!;
        validFlags[index] = online;
        this.validationCache.set(`${queue.channelId}:${playerId}`, { valid: online, timestamp: Date.now() });
        if (!online) {
          console.log(`[CentralizedMatchmaker] Player ${playerId} failed validation`);
        }
      }

      return playerIds.filter((_, i) => validFlags[i]);
    } catch (error) {
      console.error('[CentralizedMatchmaker] Error in validatePlayers:', error);
      return [];
    }
  }

  private async runWithConcurrencyLimit(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
    if (tasks.length === 0) return;
    const workerCount = Math.min(Math.max(limit, 1), tasks.length);
    let next = 0;
    const workers = Array.from({ length: workerCount }, async () => {
      while (next < tasks.length) {
        const current = next++;
        await tasks[current]();
      }
    });
    await Promise.all(workers);
  }

  private evaluatePlayerLocal(
    playerId: string,
    queue: QueueLike,
    allPlayersInQueue: string[],
    ctx: ValidationCtx,
    checkedParties: Set<string>,
    invalidParties: Set<string>
  ): { decision: 'valid' } | { decision: 'invalid' } | { decision: 'presence'; ign: string } {
    const user = ctx.userMap.get(playerId);

    if (!user) {
      console.warn(`[CentralizedMatchmaker] User ${playerId} not found in database`);
      return { decision: 'invalid' };
    }

    if (!user.ign) {
      console.warn(`[CentralizedMatchmaker] User ${playerId} has no IGN`);
      return { decision: 'invalid' };
    }

    if (user.isBanned || user.isFrozen) {
      console.warn(`[CentralizedMatchmaker] User ${playerId} is banned or frozen`);
      return { decision: 'invalid' };
    }

    if (user.elo !== undefined && (user.elo < queue.minElo || user.elo > queue.maxElo)) {
      console.warn(`[CentralizedMatchmaker] User ${playerId} ELO ${user.elo} not in queue range ${queue.minElo}-${queue.maxElo}`);
      return { decision: 'invalid' };
    }

    if (user.partyId) {
      if (invalidParties.has(user.partyId)) return { decision: 'invalid' };
      if (!checkedParties.has(user.partyId)) {
        checkedParties.add(user.partyId);
        const partyValidation = this.validatePartyLocal(user.partyId, queue, allPlayersInQueue, ctx);
        if (!partyValidation.valid) {
          console.warn(`[CentralizedMatchmaker] Party ${user.partyId} validation failed: ${partyValidation.reason}`);
          invalidParties.add(user.partyId);
          return { decision: 'invalid' };
        }
      } else if (invalidParties.has(user.partyId)) {
        return { decision: 'invalid' };
      }
    }

    const presence = PresenceService.evaluate(user.ign);
    if (presence === 'offline') {
      console.warn(`[CentralizedMatchmaker] User ${user.ign} is offline in Minecraft, skipping draft`);
      return { decision: 'invalid' };
    }
    if (presence === 'unknown') {
      return { decision: 'presence', ign: user.ign };
    }

    return { decision: 'valid' };
  }

  private validatePartyLocal(
    partyId: string,
    queue: QueueLike,
    playersInQueue: string[],
    ctx: ValidationCtx
  ): { valid: boolean; reason?: string } {
    const party = ctx.partyMap.get(partyId);

    if (!party) {
      return { valid: false, reason: 'Party not found' };
    }

    if (!party.members || party.members.length === 0) {
      return { valid: false, reason: 'Party has no members' };
    }

    const partyMembers = party.members;
    const partyMembersInQueue = partyMembers.filter((memberId: string) => playersInQueue.includes(memberId));

    if (partyMembersInQueue.length !== partyMembers.length) {
      return {
        valid: false,
        reason: `Not all party members in queue (${partyMembersInQueue.length}/${partyMembers.length})`
      };
    }

    const queuedSet = new Set(playersInQueue);
    for (const memberId of partyMembers) {
      const member = ctx.userMap.get(memberId) ?? (queuedSet.has(memberId) ? undefined : ctx.partyMemberMap.get(memberId));
      if (!member) {
        return {
          valid: false,
          reason: 'Some party members not found in database'
        };
      }

      if (member.isBanned || member.isFrozen) {
        return {
          valid: false,
          reason: `Party member ${member.discordId} is banned or frozen`
        };
      }

      if (member.elo !== undefined && (member.elo < queue.minElo || member.elo > queue.maxElo)) {
        return {
          valid: false,
          reason: `Party member ${member.discordId} ELO ${member.elo} not in queue range ${queue.minElo}-${queue.maxElo}`
        };
      }
    }

    if (partyMembers.length > queue.maxPlayers / 2) {
      return {
        valid: false,
        reason: `Party too large for queue (${partyMembers.length} > ${queue.maxPlayers / 2})`
      };
    }

    return { valid: true };
  }

  private async checkPlayerOnlinePresence(ign: string): Promise<boolean> {
    try {
      const onlineCheck = await withTimeout(
        this.wsManager.checkPlayerOnline(ign),
        3000,
        'Online check'
      );
      PresenceService.ingest(ign, onlineCheck.online === true);
      if (!onlineCheck.online) {
        console.warn(`[CentralizedMatchmaker] User ${ign} is not online`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn(`[CentralizedMatchmaker] Online check for ${ign} failed (${error instanceof Error ? error.message : String(error)}), keeping player in queue`);
      return true;
    }
  }

  private async validateSinglePlayer(
    playerId: string,
    queue: QueueLike,
    allPlayersInQueue: string[],
    checkedParties: Set<string>,
    invalidParties: Set<string>,
    ctx?: ValidationCtx
  ): Promise<boolean> {
    try {
      let user = ctx?.userMap.get(playerId);
      if (!user && !ctx) {
        user = (await User.findOne({ discordId: playerId }).lean()) ?? undefined;
      }

      if (!user) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} not found in database`);
        return false;
      }

      if (!user.ign) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} has no IGN`);
        return false;
      }

      if (user.isBanned || user.isFrozen) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} is banned or frozen`);
        return false;
      }

      if (user.elo !== undefined && (user.elo < queue.minElo || user.elo > queue.maxElo)) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} ELO ${user.elo} not in queue range ${queue.minElo}-${queue.maxElo}`);
        return false;
      }

      if (user.partyId) {
        if (invalidParties.has(user.partyId)) return false;
        if (!checkedParties.has(user.partyId)) {
          checkedParties.add(user.partyId);
          const partyValidation = ctx
            ? this.validatePartyLocal(user.partyId, queue, allPlayersInQueue, ctx)
            : await this.validateParty(user.partyId, queue, allPlayersInQueue);
          if (!partyValidation.valid) {
            console.warn(`[CentralizedMatchmaker] Party ${user.partyId} validation failed: ${partyValidation.reason}`);
            invalidParties.add(user.partyId);
            return false;
          }
        }
      }

      const presence = PresenceService.evaluate(user.ign);
      if (presence === 'offline') {
        console.warn(`[CentralizedMatchmaker] User ${user.ign} is offline in Minecraft, skipping draft`);
        return false;
      }
      if (presence === 'unknown') {
        try {
          const onlineCheck = await withTimeout(
            this.wsManager.checkPlayerOnline(user.ign),
            3000,
            'Online check'
          );
          PresenceService.ingest(user.ign, onlineCheck.online === true);
          if (!onlineCheck.online) {
            console.warn(`[CentralizedMatchmaker] User ${user.ign} is not online`);
            return false;
          }
        } catch (error) {
          console.warn(`[CentralizedMatchmaker] Online check for ${user.ign} failed (${error instanceof Error ? error.message : String(error)}), keeping player in queue`);
        }
      }

      return true;
    } catch (error) {
      console.error(`[CentralizedMatchmaker] Error validating single player ${playerId}:`, error);
      return false;
    }
  }

  private async validateParty(
    partyId: string,
    queue: QueueLike,
    playersInQueue: string[],
    ctx?: ValidationCtx
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      if (ctx) {
        return this.validatePartyLocal(partyId, queue, playersInQueue, ctx);
      }

      const Party = (await import('../models/Party')).default;
      const party = await Party.findOne({ partyId }).lean();

      if (!party) {
        return { valid: false, reason: 'Party not found' };
      }

      if (!party.members || party.members.length === 0) {
        return { valid: false, reason: 'Party has no members' };
      }

      const partyMembers = party.members;
      const partyMembersInQueue = partyMembers.filter(memberId => playersInQueue.includes(memberId));

      if (partyMembersInQueue.length !== partyMembers.length) {
        return { 
          valid: false, 
          reason: `Not all party members in queue (${partyMembersInQueue.length}/${partyMembers.length})` 
        };
      }

      const partyUsers = await User.find({ 
        discordId: { $in: partyMembers } 
      }).select('discordId elo isBanned isFrozen').lean();

      if (partyUsers.length !== partyMembers.length) {
        return { 
          valid: false, 
          reason: 'Some party members not found in database' 
        };
      }

      for (const member of partyUsers) {
        if (member.isBanned || member.isFrozen) {
          return { 
            valid: false, 
            reason: `Party member ${member.discordId} is banned or frozen` 
          };
        }

        if (member.elo !== undefined && (member.elo < queue.minElo || member.elo > queue.maxElo)) {
          return { 
            valid: false, 
            reason: `Party member ${member.discordId} ELO ${member.elo} not in queue range ${queue.minElo}-${queue.maxElo}` 
          };
        }
      }

      if (partyMembers.length > queue.maxPlayers / 2) {
        return { 
          valid: false, 
          reason: `Party too large for queue (${partyMembers.length} > ${queue.maxPlayers / 2})` 
        };
      }

      return { valid: true };
    } catch (error) {
      console.error(`[CentralizedMatchmaker] Error validating party ${partyId}:`, error);
      return { valid: false, reason: 'Validation error' };
    }
  }

  private determineQueueType(queue: QueueLike): QueueType {
    
    if (queue.maxPlayers <= 2) {
      return QueueType.RANDOM;
    }
    
    if ((queue.isPicking ?? (queue as unknown as { ispicking?: boolean }).ispicking) || queue.queueType === 'picking') {
      return QueueType.PICKING;
    }
    return QueueType.RANDOM;
  }

  private async getQueueSafely(queueId: string): Promise<QueueLike | null> {
    try {
      const cached = this.queueCache.get(queueId);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.queue;
      }

      const queue = await Queue.findOne({ channelId: queueId }).lean();
      if (queue) {
        this.queueCache.set(queueId, { queue, timestamp: Date.now() });
      }
      return queue;
    } catch (error) {
      console.error(`[CentralizedMatchmaker] Error getting queue ${queueId}:`, error);
      return null;
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public cleanup(): void {
    try {
      if (this.queueMonitorInterval) {
        clearInterval(this.queueMonitorInterval);
        this.queueMonitorInterval = null;
      }
      if (this.cacheCleanupInterval) {
        clearInterval(this.cacheCleanupInterval);
        this.cacheCleanupInterval = null;
      }

      for (const timeout of this.processingLocks.values()) {
        clearTimeout(timeout);
      }
      this.processingLocks.clear();

      this.processingStates.clear();
      this.retryQueue.clear();
      this.queueMetrics.clear();
      this.priorityQueue = [];
      this.queueCache.clear();
      this.validationCache.clear();

      this.gameManager.cleanup();
      this.pickingQueueManager.cleanup();

      console.log('[CentralizedMatchmaker] Production-grade cleanup completed');

    } catch (error) {
      console.error('[CentralizedMatchmaker] Error during cleanup:', error);
    }
  }
}