import { Client } from 'discord.js';
import Queue from '../models/Queue';
import User from '../models/User';
import { QueueType, MatchmakingResult } from '../types/GameTypes';
import { GameManager } from './GameManager';
import { RandomQueueManager } from './RandomQueueManager';
import { PickingQueueManager } from './PickingQueueManager';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { queuePlayers } from '../types/queuePlayersMemory';

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
  private queueCache: Map<string, { queue: any; timestamp: number }> = new Map();
  private validationCache: Map<string, { valid: boolean; timestamp: number }> = new Map();

  
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
    this.randomQueueManager = new RandomQueueManager(client, this, wsManager);
    this.pickingQueueManager = new PickingQueueManager(client, this, wsManager);
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

  private startCacheCleanup(): void {
    setInterval(() => {
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
    setInterval(async () => {
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
        lastProcessedAt: 0
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
      const timeSinceStart = Date.now() - state.lastProcessed;
      if (timeSinceStart < 500) {
        console.log(`[CentralizedMatchmaker] Queue ${queueId} already processing recently (${timeSinceStart}ms ago)`);
        return { success: false, gamesCreated: 0, errors: ['Queue already being processed'] };
      }
    }

    const activeGames = this.gameManager.getActiveGameCount();
    const gameBuffer = Math.max(5, Math.floor(this.MAX_CONCURRENT_GAMES * 0.1));
    if (activeGames >= this.MAX_CONCURRENT_GAMES - gameBuffer) {
      console.warn(`[CentralizedMatchmaker] Near capacity: ${activeGames}/${this.MAX_CONCURRENT_GAMES} games (buffer: ${gameBuffer})`);
      return { success: false, gamesCreated: 0, errors: ['Server near capacity'] };
    }

    state.isProcessing = true;
    state.lastProcessed = Date.now();
    state.priority = this.calculateQueuePriority(queuePlayers.get(queueId)?.length || 0, 1, metrics.lastProcessedAt);

    const errors: string[] = [];
    let gamesCreated = 0;

    try {
      const queue = await this.getQueueSafely(queueId);
      if (!queue) {
        errors.push(`Queue ${queueId} not found or inactive`);
        return { success: false, gamesCreated: 0, errors };
      }

      const players = queuePlayers.get(queueId) || [];

      if (players.length < queue.maxPlayers) {
        return { success: true, gamesCreated: 0 };
      }

      const validationPromise = this.validatePlayers(players, queue);
      const timeoutPromise = new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error('Validation timeout')), 5000)
      );

      let validPlayers: string[];
      try {
        validPlayers = await Promise.race([validationPromise, timeoutPromise]);
      } catch (validationError) {
        console.warn(`[CentralizedMatchmaker] Player validation failed for ${queueId}:`, validationError);
        validPlayers = players;
      }

      if (validPlayers.length !== players.length) {
        queuePlayers.set(queueId, validPlayers);
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

      const isPickingOverride = (queue.ispicking || queue.queueType === 'picking') && queue.maxPlayers <= 2;
      if (isPickingOverride) {
        console.log(`[CentralizedMatchmaker] Using random queue for ${queue.maxPlayers}-player game (overriding picking mode)`);
      }

      const processingPromise = queueType === QueueType.PICKING
        ? this.pickingQueueManager.processQueue(validPlayers, queue, maxGamesForThisQueue)
        : this.randomQueueManager.processQueue(validPlayers, queue, maxGamesForThisQueue);

      const processingTimeoutPromise = new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error('Processing timeout')), 30000)
      );

      try {
        gamesCreated = await Promise.race([processingPromise, processingTimeoutPromise]);
      } catch (processingError: any) {
        console.error(`[CentralizedMatchmaker] Processing error for ${queueId}:`, processingError);
        errors.push(`Processing failed: ${processingError.message}`);

        state.retryCount++;
        state.errors.push(processingError.message);

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

      const usedPlayerCount = gamesCreated * queue.maxPlayers;
      const remainingPlayers = validPlayers.slice(usedPlayerCount);
      queuePlayers.set(queueId, remainingPlayers);

      state.retryCount = 0;
      state.errors = [];
      metrics.successCount++;

      if (remainingPlayers.length >= queue.maxPlayers) {
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

    } catch (error: any) {
      console.error(`[CentralizedMatchmaker] Unexpected error processing queue ${queueId}:`, error);
      errors.push(error.message || 'Unexpected error occurred');

      state.retryCount++;
      state.errors.push(error.message);
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

  public async processAllQueues(): Promise<MatchmakingResult[]> {
    try {
      const allQueues = await Queue.find({ isActive: true }).select('channelId');
      const results: MatchmakingResult[] = [];

      for (const queue of allQueues) {
        try {
          const result = await this.processQueue(queue.channelId);
          results.push(result);

          if (results.length < allQueues.length) {
            await this.sleep(500);
          }
        } catch (error: any) {
          console.error(`[CentralizedMatchmaker] Error processing queue ${queue.channelId}:`, error);
          results.push({
            success: false,
            gamesCreated: 0,
            errors: [error.message || 'Unknown error']
          });
        }
      }

      const totalGames = results.reduce((sum, r) => sum + r.gamesCreated, 0);
      console.log(`[CentralizedMatchmaker] Processed ${allQueues.length} queues, created ${totalGames} games total`);

      return results;

    } catch (error) {
      console.error('[CentralizedMatchmaker] Error processing all queues:', error);
      return [];
    }
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

  public getGameManager(): GameManager {
    return this.gameManager;
  }

  public getStats(): {
    activeGames: number;
    processingQueues: number;
    queueCounts: Record<string, number>;
    processingStates: Record<string, ProcessingState>;
    metrics: Record<string, QueueMetrics>;
    priorityQueue: Array<{ queueId: string; priority: number; timestamp: number }>;
    systemHealth: {
      totalProcessed: number;
      successRate: number;
      averageProcessingTime: number;
      errorRate: number;
    };
  } {
    const queueCounts: Record<string, number> = {};
    for (const [queueId, players] of queuePlayers.entries()) {
      queueCounts[queueId] = players.length;
    }

    const processingStates: Record<string, ProcessingState> = {};
    for (const [queueId, state] of this.processingStates.entries()) {
      processingStates[queueId] = { ...state };
    }

    const metrics: Record<string, QueueMetrics> = {};
    for (const [queueId, metric] of this.queueMetrics.entries()) {
      metrics[queueId] = { ...metric };
    }

    
    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalErrors = 0;
    let totalProcessingTime = 0;
    let queueCount = 0;

    for (const metric of this.queueMetrics.values()) {
      totalProcessed += metric.processedCount;
      totalSuccess += metric.successCount;
      totalErrors += metric.errorCount;
      totalProcessingTime += metric.averageProcessingTime;
      queueCount++;
    }

    const systemHealth = {
      totalProcessed,
      successRate: totalProcessed > 0 ? (totalSuccess / totalProcessed) * 100 : 0,
      averageProcessingTime: queueCount > 0 ? totalProcessingTime / queueCount : 0,
      errorRate: totalProcessed > 0 ? (totalErrors / totalProcessed) * 100 : 0
    };

    return {
      activeGames: this.gameManager.getActiveGameCount(),
      processingQueues: this.processingStates.size,
      queueCounts,
      processingStates,
      metrics,
      priorityQueue: [...this.priorityQueue],
      systemHealth
    };
  }

  private async validatePlayers(playerIds: string[], queue: any): Promise<string[]> {
    try {
      const validPlayers: string[] = [];
      const checkedParties = new Set<string>();
      
      for (const playerId of playerIds) {
        try {
          const cacheKey = `${playerId}_${Date.now()}`;
          const cached = this.validationCache.get(playerId);
          
          if (cached && Date.now() - cached.timestamp < this.VALIDATION_CACHE_TTL) {
            if (cached.valid) {
              validPlayers.push(playerId);
            }
            continue;
          }

          const isValid = await this.validateSinglePlayer(playerId, queue, playerIds, checkedParties);
          
          this.validationCache.set(playerId, { valid: isValid, timestamp: Date.now() });
          
          if (isValid) {
            validPlayers.push(playerId);
          } else {
            console.log(`[CentralizedMatchmaker] Player ${playerId} failed validation`);
          }
        } catch (error) {
          console.error(`[CentralizedMatchmaker] Error validating player ${playerId}:`, error);
        }
      }

      return validPlayers;
    } catch (error) {
      console.error('[CentralizedMatchmaker] Error in validatePlayers:', error);
      return [];
    }
  }

  private async validateSinglePlayer(
    playerId: string, 
    queue: any, 
    allPlayersInQueue: string[],
    checkedParties: Set<string>
  ): Promise<boolean> {
    try {
      const user = await User.findOne({ discordId: playerId }).lean();
      
      if (!user) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} not found in database`);
        return false;
      }

      if (!user.ign) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} has no IGN`);
        return false;
      }

      if (user.isbanned || user.isfrozen) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} is banned or frozen`);
        return false;
      }

      if (user.elo < queue.minElo || user.elo > queue.maxElo) {
        console.warn(`[CentralizedMatchmaker] User ${playerId} ELO ${user.elo} not in queue range ${queue.minElo}-${queue.maxElo}`);
        return false;
      }

      if (user.partyId && !checkedParties.has(user.partyId)) {
        checkedParties.add(user.partyId);
        
        const partyValidation = await this.validateParty(user.partyId, queue, allPlayersInQueue);
        if (!partyValidation.valid) {
          console.warn(`[CentralizedMatchmaker] Party ${user.partyId} validation failed: ${partyValidation.reason}`);
          return false;
        }
      }

      const onlineCheck = await Promise.race([
        this.wsManager.checkPlayerOnline(user.ign),
        new Promise<{ online: boolean }>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 3000)
        )
      ]).catch(() => ({ online: false }));

      if (!onlineCheck.online) {
        console.warn(`[CentralizedMatchmaker] User ${user.ign} is not online`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`[CentralizedMatchmaker] Error validating single player ${playerId}:`, error);
      return false;
    }
  }

  private async validateParty(
    partyId: string, 
    queue: any, 
    playersInQueue: string[]
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
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
      }).select('discordId elo isbanned isfrozen').lean();

      if (partyUsers.length !== partyMembers.length) {
        return { 
          valid: false, 
          reason: 'Some party members not found in database' 
        };
      }

      for (const member of partyUsers) {
        if (member.isbanned || member.isfrozen) {
          return { 
            valid: false, 
            reason: `Party member ${member.discordId} is banned or frozen` 
          };
        }

        if (member.elo < queue.minElo || member.elo > queue.maxElo) {
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

  private determineQueueType(queue: any): QueueType {
    
    if (queue.maxPlayers <= 2) {
      return QueueType.RANDOM;
    }
    
    if (queue.ispicking || queue.queueType === 'picking') {
      return QueueType.PICKING;
    }
    return QueueType.RANDOM;
  }

  private async getQueueSafely(queueId: string): Promise<any | null> {
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
      this.randomQueueManager.cleanup();
      this.pickingQueueManager.cleanup();

      console.log('[CentralizedMatchmaker] Production-grade cleanup completed');

    } catch (error) {
      console.error('[CentralizedMatchmaker] Error during cleanup:', error);
    }
  }

  
  public getQueueHealth(queueId: string): {
    isHealthy: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const state = this.processingStates.get(queueId);
    const metrics = this.queueMetrics.get(queueId);
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (!state || !metrics) {
      return {
        isHealthy: false,
        issues: ['Queue not found or not initialized'],
        recommendations: ['Check if queue exists and is active']
      };
    }

    
    if (metrics.processedCount > 0 && (metrics.errorCount / metrics.processedCount) > 0.3) {
      issues.push('High error rate detected');
      recommendations.push('Check queue configuration and player validation');
    }

    
    if (metrics.averageProcessingTime > 10000) {
      issues.push('Slow processing times');
      recommendations.push('Consider optimizing queue processing logic');
    }

    
    if (state.retryCount >= this.MAX_RETRIES) {
      issues.push('Maximum retries reached');
      recommendations.push('Queue may need manual intervention');
    }

    
    if (state.isProcessing && Date.now() - state.lastProcessed > this.LOCK_TIMEOUT) {
      issues.push('Queue appears to be stuck');
      recommendations.push('Consider resetting queue processing state');
    }

    return {
      isHealthy: issues.length === 0,
      issues,
      recommendations
    };
  }

  public resetQueueHealth(queueId: string): boolean {
    try {
      this.resetProcessingState(queueId);

      const metrics = this.queueMetrics.get(queueId);
      if (metrics) {
        metrics.errorCount = 0;
        metrics.processedCount = Math.max(1, metrics.processedCount);
        metrics.successCount = Math.max(1, metrics.successCount);
      }

      console.log(`[CentralizedMatchmaker] Reset health for queue ${queueId}`);
      return true;
    } catch (error) {
      console.error(`[CentralizedMatchmaker] Error resetting queue health for ${queueId}:`, error);
      return false;
    }
  }

  public isPlayerInAnyQueue(discordId: string): boolean {
    
    for (const [queueId, players] of queuePlayers.entries()) {
      if (players.includes(discordId)) {
        return true;
      }
    }

    return false;
  }
}