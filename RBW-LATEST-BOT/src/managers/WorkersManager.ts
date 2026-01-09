import { Client, Guild, GuildMember, TextChannel, VoiceChannel, ChannelType, PermissionFlagsBits } from 'discord.js';
import config from '../config/config';

interface WorkerTask {
  id: string;
  type: 'channel_create' | 'channel_delete' | 'member_move' | 'member_nickname' | 'member_roles' | 'message_send';
  priority: number;
  data: any;
  retries: number;
  timestamp: number;
  resolve?: (value: any) => void;
  reject?: (error: any) => void;
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
              'MessageContent'
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

      
      const readyPromises = this.workers.map(worker =>
        new Promise<void>((resolve) => {
          if (worker.isReady) {
            resolve();
          } else {
            const checkReady = () => {
              if (worker.isReady) {
                resolve();
              } else {
                setTimeout(checkReady, 100);
              }
            };
            checkReady();
          }
        })
      );

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

    
    for (let priority = 10; priority >= 0; priority--) {
      const queue = this.taskQueue.get(priority);
      if (!queue || queue.length === 0) continue;

      
      const availableWorkers = this.workers.filter(worker =>
        worker.isReady &&
        worker.currentTasks.size < this.MAX_CONCURRENT_TASKS_PER_WORKER &&
        Date.now() > worker.rateLimitedUntil
      );

      if (availableWorkers.length === 0) continue;

      
      const tasksToProcess = queue.splice(0, availableWorkers.length);

      for (let i = 0; i < tasksToProcess.length && i < availableWorkers.length; i++) {
        const task = tasksToProcess[i];
        const worker = availableWorkers[i];

        this.executeTask(worker, task);
      }
    }
  }

  private async executeTask(worker: WorkerClient, task: WorkerTask): Promise<void> {
    const startTime = Date.now();
    worker.currentTasks.add(task.id);
    this.processingTasks.set(task.id, task);

    try {
      let result: any;

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

      
      const processingTime = Date.now() - startTime;
      worker.stats.tasksProcessed++;
      worker.stats.tasksSucceeded++;
      worker.stats.lastActiveAt = Date.now();
      worker.stats.averageProcessingTime =
        (worker.stats.averageProcessingTime * (worker.stats.tasksProcessed - 1) + processingTime) / worker.stats.tasksProcessed;

      if (task.resolve) {
        task.resolve(result);
      }

    } catch (error: any) {
      
      if (this.isPermissionError(error)) {
        try {
          const fallbackResult = await this.executeTaskOnMainClient(task.type, task.data);
          
          const processingTime = Date.now() - startTime;
          worker.stats.tasksProcessed++;
          worker.stats.tasksSucceeded++;
          worker.stats.lastActiveAt = Date.now();
          worker.stats.averageProcessingTime =
            (worker.stats.averageProcessingTime * (worker.stats.tasksProcessed - 1) + processingTime) / worker.stats.tasksProcessed;
          if (task.resolve) task.resolve(fallbackResult);
          return;
        } catch (mainErr: any) {
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

      
      if (error.code === 429 || error.status === 429) {
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

  private async executeChannelCreate(client: Client, data: any): Promise<any> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    return await guild.channels.create(data.options);
  }

  private isPermissionError(error: any): boolean {
    const code = (error && (error.code as any)) ?? (error && (error.rawError?.code as any));
    const status = error && error.status;
    const msg = (error && error.message) ? String(error.message).toLowerCase() : '';
    return code === 50013 || status === 403 || msg.includes('missing permissions');
  }

  private async executeChannelDelete(client: Client, data: any): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const channel = guild.channels.cache.get(data.channelId);
    if (channel) {
      await channel.delete();
    }
  }

  private async executeMemberMove(client: Client, data: any): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const member = guild.members.cache.get(data.memberId);
    if (member?.voice?.channel) {
      await member.voice.setChannel(data.channelId);
    }
  }

  private async executeMemberNickname(client: Client, data: any): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const member = guild.members.cache.get(data.memberId);
    if (member) {
      await member.setNickname(data.nickname);
    }
  }

  private async executeMemberRoles(client: Client, data: any): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const member = guild.members.cache.get(data.memberId);
    if (!member) return;

    if (data.add && data.add.length > 0) {
      await member.roles.add(data.add);
    }

    if (data.remove && data.remove.length > 0) {
      await member.roles.remove(data.remove);
    }
  }

  private async executeMessageSend(client: Client, data: any): Promise<any> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');

    const channel = guild.channels.cache.get(data.channelId) as TextChannel;
    if (!channel || !channel.isTextBased()) {
      throw new Error('Channel not found or not text-based');
    }

    return await channel.send(data.message);
  }

  private performHealthCheck(): void {
    if (!this.isEnabled) return;

    const now = Date.now();
    let healthyWorkers = 0;

    for (const worker of this.workers) {
      
      const isHealthy = worker.isReady && (
        worker.stats.lastActiveAt === 0 || 
        now - worker.stats.lastActiveAt < 300000 
      );

      if (isHealthy) {
        healthyWorkers++;
      }
    }


    
    const totalStats = this.workers.reduce((acc, worker) => ({
      tasksProcessed: acc.tasksProcessed + worker.stats.tasksProcessed,
      tasksSucceeded: acc.tasksSucceeded + worker.stats.tasksSucceeded,
      tasksFailed: acc.tasksFailed + worker.stats.tasksFailed,
      rateLimitHits: acc.rateLimitHits + worker.stats.rateLimitHits
    }), { tasksProcessed: 0, tasksSucceeded: 0, tasksFailed: 0, rateLimitHits: 0 });

    if (totalStats.tasksProcessed > 0) {
      const successRate = (totalStats.tasksSucceeded / totalStats.tasksProcessed) * 100;
    }
  }

  
  public async createChannel(options: any, priority: number = 5): Promise<any> {
    return this.addTask('channel_create', { options }, priority);
  }

  public async deleteChannel(channelId: string, priority: number = 3): Promise<void> {
    return this.addTask('channel_delete', { channelId }, priority);
  }

  public async moveMembers(memberIds: string[], channelId: string, priority: number = 7): Promise<PromiseSettledResult<void>[]> {
    const promises = memberIds.map(memberId =>
      this.addTask('member_move', { memberId, channelId }, priority)
    );
    return Promise.allSettled(promises);
  }

  public async moveMembersAndWait(memberIds: string[], channelId: string, priority: number = 7): Promise<void> {
    const results = await this.moveMembers(memberIds, channelId, priority);
    const failures = results.filter(result => result.status === 'rejected');

    if (failures.length > 0) {
      console.warn(`[WorkersManager] ${failures.length}/${memberIds.length} member moves failed`);
      failures.forEach((failure, index) => {
        if (failure.status === 'rejected') {
          console.warn(`[WorkersManager] Failed to move member ${memberIds[index]}:`, failure.reason);
        }
      });
    }

    const successCount = results.length - failures.length;
    console.log(`[WorkersManager] Successfully moved ${successCount}/${memberIds.length} members`);
  }

  public async setMemberNickname(memberId: string, nickname: string, priority: number = 4): Promise<void> {
    return this.addTask('member_nickname', { memberId, nickname }, priority);
  }

  public async updateMemberRoles(memberId: string, add: string[] = [], remove: string[] = [], priority: number = 6): Promise<void> {
    return this.addTask('member_roles', { memberId, add, remove }, priority);
  }

  public async sendMessage(channelId: string, message: any, _priority: number = 8): Promise<any> {
    return this.executeTaskOnMainClient('message_send', { channelId, message });
  }

  private async addTask(type: WorkerTask['type'], data: any, priority: number): Promise<any> {
    
    if (!this.isEnabled) {
      return this.executeTaskOnMainClient(type, data);
    }

    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        id: `task_${++this.taskIdCounter}`,
        type,
        priority: Math.max(0, Math.min(10, priority)),
        data,
        retries: 0,
        timestamp: Date.now(),
        resolve,
        reject
      };

      
      this.taskQueue.get(task.priority)?.push(task);

      
      setTimeout(() => {
        if (this.processingTasks.has(task.id)) {
          this.processingTasks.delete(task.id);
          reject(new Error('Task timeout'));
        }
      }, this.TASK_TIMEOUT);
    });
  }

  private async executeTaskOnMainClient(type: WorkerTask['type'], data: any): Promise<any> {
    
    const guild = this.mainClient.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');
    try {
      switch (type) {
        case 'channel_create':
          return await guild.channels.create(data.options);
        case 'channel_delete':
          const channel = guild.channels.cache.get(data.channelId);
          if (channel) await channel.delete();
          return;
        case 'member_move':
          const member = guild.members.cache.get(data.memberId);
          if (member?.voice?.channel) {
            await member.voice.setChannel(data.channelId);
          }
          return;
        case 'member_nickname':
          const memberNick = guild.members.cache.get(data.memberId);
          if (memberNick) await memberNick.setNickname(data.nickname);
          return;
        case 'member_roles':
          const memberRoles = guild.members.cache.get(data.memberId);
          if (memberRoles) {
            if (data.add?.length > 0) await memberRoles.roles.add(data.add);
            if (data.remove?.length > 0) await memberRoles.roles.remove(data.remove);
          }
          return;
        case 'message_send':
          const textChannel = guild.channels.cache.get(data.channelId) as TextChannel;
          if (textChannel?.isTextBased()) {
            return await textChannel.send(data.message);
          }
          return;
      }
    } catch (e: any) {
      if (this.isPermissionError(e)) {
        
        return;
      }
      throw e;
    }
  }

  public getStats(): {
    enabled: boolean;
    workersCount: number;
    queuedTasks: number;
    processingTasks: number;
    workerStats: WorkerStats[];
  } {
    const queuedTasks = Array.from(this.taskQueue.values()).reduce((sum, queue) => sum + queue.length, 0);

    return {
      enabled: this.isEnabled,
      workersCount: this.workers.length,
      queuedTasks,
      processingTasks: this.processingTasks.size,
      workerStats: this.workers.map(w => ({ ...w.stats }))
    };
  }

  public cleanup(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    
    this.workers.forEach(worker => {
      if (worker.client) {
        worker.client.destroy();
      }
    });

    this.workers = [];
    this.taskQueue.clear();
    this.processingTasks.clear();

    console.log('[WorkersManager] Cleanup completed');
  }
}