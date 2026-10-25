import { Client, TextChannel, type GuildChannelCreateOptions, type MessageCreateOptions } from 'discord.js';
import config from '../config/config';

type WorkerTaskData = Record<string, unknown>;

interface WorkerTask {
  id: string;
  type: 'channel_create' | 'channel_delete' | 'member_move' | 'member_nickname' | 'member_roles' | 'message_send';
  priority: number;
  data: WorkerTaskData;
  retries: number;
  timestamp: number;
  resolve?: (value: unknown) => void;
  reject?: (reason?: unknown) => void;
  timeout?: NodeJS.Timeout;
}

interface WorkerStats {
  tasksProcessed: number;
  tasksSucceeded: number;
  tasksFailed: number;
  averageProcessingTime: number;
  lastActiveAt: number;
  rateLimitHits: number;
}

interface WorkerClient {
  client: Client;
  isReady: boolean;
  stats: WorkerStats;
  currentTasks: Set<string>;
  rateLimitedUntil: number;
}

export class WorkersManager {
  private static instance: WorkersManager;
  private mainClient: Client;
  private workers: WorkerClient[] = [];
  private taskQueue: Map<number, WorkerTask[]> = new Map(); 
  private processingTasks: Map<string, WorkerTask> = new Map();
  private taskIdCounter = 0;
  private isEnabled = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private consecutiveFailures = new Map<WorkerClient, number>();
  private readonly FAILURE_QUARANTINE_THRESHOLD = 3;

  
  private readonly MAX_RETRIES = 3;
  private readonly TASK_TIMEOUT = 30000;
  private readonly PROCESSING_INTERVAL = 100; 
  private readonly HEALTH_CHECK_INTERVAL = 30000; 
  private readonly RATE_LIMIT_COOLDOWN = 60000; 
  private readonly MAX_CONCURRENT_TASKS_PER_WORKER = 5;

  private constructor(mainClient: Client) {
    this.mainClient = mainClient;
    this.isEnabled = config.workers.enabled;

    
    for (let i = 0; i <= 10; i++) {
      this.taskQueue.set(i, []);
    }
  }

  public static getInstance(mainClient?: Client): WorkersManager {
    if (!WorkersManager.instance && mainClient) {
      WorkersManager.instance = new WorkersManager(mainClient);
    }
    return WorkersManager.instance;
  }

  public async waitForWorkerReady(worker: WorkerClient, timeoutMs = 30000): Promise<boolean> {
    if (worker.isReady) return true;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        console.warn('[WorkersManager] Timed out waiting for a worker to become ready, continuing without it');
        resolve(false);
      }, timeoutMs);
      const checkReady = () => {
        if (worker.isReady) {
          clearTimeout(timer);
          resolve(true);
        } else {
          setTimeout(checkReady, 100);
        }
      };
      checkReady();
    });
  }

  public async initialize(): Promise<void> {
    if (!this.isEnabled) {
      console.log('[WorkersManager] Workers disabled in config, using main client only');
      return;
    }

    console.log('[WorkersManager] Initializing worker clients...');

    try {
      
      const initPromises = config.workers.tokens.map(async (token, index) => {
        try {
          const client = new Client({
            intents: [
              'Guilds',
              'GuildMessages',
              'GuildVoiceStates',
              'MessageContent',
              'GuildMembers'
            ]
          });

          const workerClient: WorkerClient = {
            client,
            isReady: false,
            stats: {
              tasksProcessed: 0,
              tasksSucceeded: 0,
              tasksFailed: 0,
              averageProcessingTime: 0,
              lastActiveAt: 0,
              rateLimitHits: 0
            },
            currentTasks: new Set(),
            rateLimitedUntil: 0
          };

          
          client.once('ready', () => {
            workerClient.isReady = true;
            console.log(`[WorkersManager] Worker ${index + 1} ready: ${client.user?.tag}`);
          });

          client.on('error', (error) => {
            console.error(`[WorkersManager] Worker ${index + 1} error:`, error);
          });

          
          client.rest.on('rateLimited', (rateLimitInfo) => {
            console.warn(`[WorkersManager] Worker ${index + 1} rate limited:`, rateLimitInfo);
            workerClient.rateLimitedUntil = Date.now() + this.RATE_LIMIT_COOLDOWN;
            workerClient.stats.rateLimitHits++;
          });

          await client.login(token);
          this.workers.push(workerClient);

          console.log(`[WorkersManager] Worker ${index + 1} initialized successfully`);
        } catch (error) {
          console.error(`[WorkersManager] Failed to initialize worker ${index + 1}:`, error);
        }
      });

      await Promise.allSettled(initPromises);

      
      const readyPromises = this.workers.map(worker => this.waitForWorkerReady(worker));

      await Promise.all(readyPromises);

      console.log(`[WorkersManager] ${this.workers.length} workers ready`);

      
      this.startProcessing();
      this.startHealthCheck();

    } catch (error) {
      console.error('[WorkersManager] Failed to initialize workers:', error);
      this.isEnabled = false;
    }
  }

  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      this.processTasks();
    }, this.PROCESSING_INTERVAL);
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  private async processTasks(): Promise<void> {
    if (!this.isEnabled || this.workers.length === 0) return;
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      const now = Date.now();
      const budgets = new Map<WorkerClient, number>();
      for (const worker of this.workers) {
        if (!worker.isReady || now <= worker.rateLimitedUntil) continue;
        const free = this.MAX_CONCURRENT_TASKS_PER_WORKER - worker.currentTasks.size;
        if (free > 0) budgets.set(worker, free);
      }
      if (budgets.size === 0) return;

      for (let priority = 10; priority >= 0; priority--) {
        const queue = this.taskQueue.get(priority);
        if (!queue || queue.length === 0) continue;

        let progressed = true;
        while (queue.length > 0 && progressed) {
          progressed = false;
          for (const [worker, budget] of budgets) {
            if (budget <= 0 || queue.length === 0) continue;
            const task = queue.shift();
            if (!task) continue;
            budgets.set(worker, budget - 1);
            progressed = true;
            void this.executeTask(worker, task);
          }
        }
        let hasBudget = false;
        for (const b of budgets.values()) {
          if (b > 0) {
            hasBudget = true;
            break;
          }
        }
        if (!hasBudget) break;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeTask(worker: WorkerClient, task: WorkerTask): Promise<void> {
    const startTime = Date.now();
    worker.currentTasks.add(task.id);
    this.processingTasks.set(task.id, task);
    if (task.timeout) {
      clearTimeout(task.timeout);
      task.timeout = undefined;
    }

    try {
      let result: unknown;

      switch (task.type) {
        case 'channel_create':
          result = await this.executeChannelCreate(worker.client, task.data);
          break;
        case 'channel_delete':
          result = await this.executeChannelDelete(worker.client, task.data);
          break;
        case 'member_move':
          result = await this.executeMemberMove(worker.client, task.data);
          break;
        case 'member_nickname':
          result = await this.executeMemberNickname(worker.client, task.data);
          break;
        case 'member_roles':
          result = await this.executeMemberRoles(worker.client, task.data);
          break;
        case 'message_send':
          result = await this.executeMessageSend(worker.client, task.data);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }

      
      this.recordTaskCompletion(worker, startTime, true);
      this.consecutiveFailures.set(worker, 0);

      if (task.resolve) {
        task.resolve(result);
      }

    } catch (error) {
      const failures = (this.consecutiveFailures.get(worker) ?? 0) + 1;
      this.consecutiveFailures.set(worker, failures);
      if (failures >= this.FAILURE_QUARANTINE_THRESHOLD) {
        worker.rateLimitedUntil = Date.now() + this.RATE_LIMIT_COOLDOWN;
        worker.stats.rateLimitHits++;
        this.consecutiveFailures.set(worker, 0);
      }

      if (this.isPermissionError(error)) {
        try {
          const fallbackResult = await this.executeTaskOnMainClient(task.type, task.data);
          
          this.recordTaskCompletion(worker, startTime, true);
          if (task.resolve) task.resolve(fallbackResult);
          return;
        } catch (mainErr) {
          if (this.isPermissionError(mainErr)) {
            worker.stats.tasksProcessed++;
            worker.stats.tasksSucceeded++;
            worker.stats.lastActiveAt = Date.now();
            if (task.resolve) task.resolve(undefined);
            return;
          }
          
          console.error(`[WorkersManager] Task ${task.id} failed on main client:`, mainErr);
        }
      } else {
        console.error(`[WorkersManager] Task ${task.id} failed:`, error);
      }

      
      if (this.isRateLimitError(error)) {
        worker.rateLimitedUntil = Date.now() + this.RATE_LIMIT_COOLDOWN;
        worker.stats.rateLimitHits++;
      }

      
      if (task.retries < this.MAX_RETRIES) {
        task.retries++;
        console.log(`[WorkersManager] Retrying task ${task.id} (attempt ${task.retries}/${this.MAX_RETRIES})`);

        
        const retryPriority = Math.max(0, task.priority - 1);
        this.taskQueue.get(retryPriority)?.push(task);
      } else {
        
        worker.stats.tasksFailed++;
        if (task.reject) {
          task.reject(error);
        }
      }

      worker.stats.tasksProcessed++;
      worker.stats.lastActiveAt = Date.now();
    } finally {
      worker.currentTasks.delete(task.id);
      this.processingTasks.delete(task.id);
    }
  }

  private async executeChannelCreate(client: Client, data: WorkerTaskData): Promise<unknown> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    return await guild.channels.create(data.options as GuildChannelCreateOptions);
  }

  private isPermissionError(error: unknown): boolean {
    const err = this.asErrorRecord(error);
    if (!err) return false;
    const code = err.code ?? err.rawError?.code;
    const status = err.status;
    const msg = typeof err.message === 'string' ? err.message.toLowerCase() : '';
    return code === 50013 || status === 403 || msg.includes('missing permissions');
  }

  private isRateLimitError(error: unknown): boolean {
    const err = this.asErrorRecord(error);
    if (!err) return false;
    return err.code === 429 || err.status === 429;
  }

  private asErrorRecord(error: unknown): { code?: unknown; status?: unknown; message?: unknown; rawError?: { code?: unknown } } | null {
    if (typeof error !== 'object' || error === null) return null;
    return error as { code?: unknown; status?: unknown; message?: unknown; rawError?: { code?: unknown } };
  }

  private recordTaskCompletion(worker: WorkerClient, startTime: number, success: boolean) {
    const processingTime = Date.now() - startTime;
    worker.stats.tasksProcessed++;
    if (success) worker.stats.tasksSucceeded++;
    worker.stats.lastActiveAt = Date.now();
    worker.stats.averageProcessingTime =
      (worker.stats.averageProcessingTime * (worker.stats.tasksProcessed - 1) + processingTime) / worker.stats.tasksProcessed;
  }

  private async executeChannelDelete(client: Client, data: WorkerTaskData): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const channel = guild.channels.cache.get(data.channelId as string);
    if (channel) {
      await channel.delete();
    }
  }

  private async executeMemberMove(client: Client, data: WorkerTaskData): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const member = guild.members.cache.get(data.memberId as string);
    if (member?.voice?.channel) {
      await member.voice.setChannel(data.channelId as string);
    }
  }

  private async executeMemberNickname(client: Client, data: WorkerTaskData): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const member = guild.members.cache.get(data.memberId as string);
    if (member) {
      await member.setNickname(data.nickname as string | null);
    }
  }

  private async executeMemberRoles(client: Client, data: WorkerTaskData): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const member = guild.members.cache.get(data.memberId as string);
    if (!member) return;

    const add = Array.isArray(data.add)
      ? data.add.filter((role): role is string => typeof role === 'string')
      : [];
    const remove = Array.isArray(data.remove)
      ? data.remove.filter((role): role is string => typeof role === 'string')
      : [];

    if (add.length > 0) {
      await member.roles.add(add);
    }

    if (remove.length > 0) {
      await member.roles.remove(remove);
    }
  }

  private async executeMessageSend(client: Client, data: WorkerTaskData): Promise<unknown> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const channel = guild.channels.cache.get(data.channelId as string) as TextChannel;
    if (!channel || !channel.isTextBased()) {
      throw new Error('Channel not found or not text-based');
    }

    return await channel.send(data.message as string | MessageCreateOptions);
  }

  private performHealthCheck(): void {
    if (!this.isEnabled) return;
    const now = Date.now();
    let quarantined = 0;
    for (const worker of this.workers) {
      if (now < worker.rateLimitedUntil) quarantined++;
      else this.consecutiveFailures.delete(worker);
    }
    if (quarantined > 0) {
      console.log(`[WorkersManager] Health check: ${quarantined}/${this.workers.length} workers quarantined`);
    }
  }

  
  public async createChannel<T extends { id: string } = { id: string }>(options: GuildChannelCreateOptions, priority: number = 5): Promise<T> {
    return this.addTask<T>('channel_create', { options }, priority);
  }

  public async deleteChannel(channelId: string, priority: number = 3): Promise<void> {
    await this.addTask<void>('channel_delete', { channelId }, priority);
  }

  public async moveMembers(memberIds: string[], channelId: string, priority: number = 7): Promise<PromiseSettledResult<void>[]> {
    const promises = memberIds.map(memberId =>
      this.addTask<void>('member_move', { memberId, channelId }, priority)
    );
    return Promise.allSettled(promises);
  }

  public async setMemberNickname(memberId: string, nickname: string, priority: number = 4): Promise<void> {
    await this.addTask<void>('member_nickname', { memberId, nickname }, priority);
  }

  public async updateMemberRoles(memberId: string, add: string[] = [], remove: string[] = [], priority: number = 6): Promise<void> {
    await this.addTask<void>('member_roles', { memberId, add, remove }, priority);
  }

  public async sendMessage(channelId: string, message: string | MessageCreateOptions, _priority: number = 8): Promise<unknown> {
    return this.executeTaskOnMainClient('message_send', { channelId, message });
  }

  private async addTask<T = unknown>(type: WorkerTask['type'], data: WorkerTaskData, priority: number): Promise<T> {
    
    if (!this.isEnabled) {
      return this.executeTaskOnMainClient(type, data) as Promise<T>;
    }

    return new Promise<T>((resolve, reject) => {
      const task: WorkerTask = {
        id: `task_${++this.taskIdCounter}`,
        type,
        priority: Math.max(0, Math.min(10, priority)),
        data,
        retries: 0,
        timestamp: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject
      };

      
      this.taskQueue.get(task.priority)?.push(task);

      
      task.timeout = setTimeout(() => {
        if (!this.processingTasks.has(task.id)) {
          const queue = this.taskQueue.get(task.priority);
          if (queue) {
            const index = queue.indexOf(task);
            if (index !== -1) {
              queue.splice(index, 1);
            }
          }
          reject(new Error(`Task timeout (${type})`));
        }
      }, this.TASK_TIMEOUT);
    });
  }

  private async executeTaskOnMainClient(type: WorkerTask['type'], data: WorkerTaskData): Promise<unknown> {
    const guild = this.mainClient.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');
    try {
      switch (type) {
        case 'channel_create':
          return await this.executeChannelCreate(this.mainClient, data);
        case 'channel_delete':
          return await this.executeChannelDelete(this.mainClient, data);
        case 'member_move':
          return await this.executeMemberMove(this.mainClient, data);
        case 'member_nickname':
          return await this.executeMemberNickname(this.mainClient, data);
        case 'member_roles':
          return await this.executeMemberRoles(this.mainClient, data);
        case 'message_send':
          return await this.executeMessageSend(this.mainClient, data);
      }
    } catch (e) {
      if (this.isPermissionError(e)) {
        return;
      }
      throw e;
    }
  }
}