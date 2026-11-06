import { Client, TextChannel, type GuildChannelCreateOptions, type MessageCreateOptions } from 'discord.js';
import config from '../config/config';

type WorkerTaskData = Record<string, unknown>;
type WorkerTaskType = 'channel_create' | 'channel_delete' | 'channel_status' | 'member_move' | 'member_nickname' | 'member_roles' | 'message_send';
type WorkerTaskState = 'queued' | 'running' | 'done';

interface WorkerTask {
  id: string;
  type: WorkerTaskType;
  priority: number;
  data: WorkerTaskData;
  retries: number;
  timestamp: number;
  state: WorkerTaskState;
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
  routeCooldowns: Map<string, number>;
  routeLastAssignedAt: Map<string, number>;
  activeRoutes: Map<string, number>;
  activeByType: Map<WorkerTaskType, number>;
  typeLatency: Map<WorkerTaskType, number>;
  tokens: number;
  lastTokenRefill: number;
  lastAssignedAt: number;
  lastRateLimitAt: number;
}

type RateLimitInfo = {
  global?: boolean;
  timeToReset?: number;
  retryAfter?: number;
  url?: string;
  route?: string;
  majorParameter?: string;
  method?: string;
};

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const MAX_RETRIES = intEnv('WORKER_MAX_RETRIES', 3, 0, 10);
const TASK_TIMEOUT = intEnv('WORKER_TASK_TIMEOUT_MS', 30000, 1000, 300000);
const PROCESSING_INTERVAL = intEnv('WORKER_PROCESS_INTERVAL_MS', 50, 10, 1000);
const HEALTH_CHECK_INTERVAL = intEnv('WORKER_HEALTH_INTERVAL_MS', 30000, 5000, 300000);
const MAX_CONCURRENT_TASKS_PER_WORKER = intEnv('WORKER_MAX_CONCURRENT_TASKS', 4, 1, 20);
const TASK_RATE_PER_SECOND = intEnv('WORKER_TASKS_PER_SECOND', 8, 1, 50);
const TASK_BURST = intEnv('WORKER_TASK_BURST', 8, 1, 100);
const MESSAGE_ROUTE_INTERVAL_MS = intEnv('WORKER_MESSAGE_ROUTE_INTERVAL_MS', 1000, 100, 30000);
const CHANNEL_ROUTE_INTERVAL_MS = intEnv('WORKER_CHANNEL_ROUTE_INTERVAL_MS', 1500, 250, 60000);
const MEMBER_ROUTE_INTERVAL_MS = intEnv('WORKER_MEMBER_ROUTE_INTERVAL_MS', 300, 100, 10000);
const FAILURE_QUARANTINE_THRESHOLD = intEnv('WORKER_FAILURE_THRESHOLD', 3, 2, 20);
const FAILURE_QUARANTINE_MS = intEnv('WORKER_FAILURE_QUARANTINE_MS', 15000, 1000, 300000);
const DEFAULT_RATE_LIMIT_WAIT_MS = intEnv('WORKER_RATE_LIMIT_WAIT_MS', 1500, 250, 60000);
const RATE_LIMIT_MEMORY_MS = intEnv('WORKER_RATE_LIMIT_MEMORY_MS', 30000, 1000, 300000);
const MAX_QUEUE_SIZE = intEnv('WORKER_QUEUE_MAX', 500, 50, 100000);
const ROUTE_IDLE_CLEANUP_MS = 300000;

export class WorkersManager {
  private static instance: WorkersManager;
  private readonly mainClient: Client;
  private workers: WorkerClient[] = [];
  private readonly taskQueue: Map<number, WorkerTask[]> = new Map();
  private readonly processingTasks: Map<string, WorkerTask> = new Map();
  private taskIdCounter = 0;
  private queuedTaskCount = 0;
  private isEnabled = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly consecutiveFailures = new Map<WorkerClient, number>();

  private constructor(mainClient: Client) {
    this.mainClient = mainClient;
    this.isEnabled = config.workers.enabled;

    for (let i = 0; i <= 10; i += 1) {
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
      let settled = false;
      let timer: NodeJS.Timeout;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => {
        console.warn('[WorkersManager] Timed out waiting for a worker to become ready, continuing without it');
        finish(false);
      }, timeoutMs);
      const checkReady = () => {
        if (settled) return;
        if (worker.isReady) finish(true);
        else setTimeout(checkReady, 100);
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
              'GuildMembers',
            ],
          });

          const workerClient = this.createWorkerClient(client);

          client.once('ready', () => {
            workerClient.isReady = true;
            console.log(`[WorkersManager] Worker ${index + 1} ready: ${client.user?.tag}`);
          });

          client.on('error', (error) => {
            console.error(`[WorkersManager] Worker ${index + 1} error:`, error);
          });

          client.rest.on('rateLimited', (info: RateLimitInfo) => {
            this.handleRateLimit(workerClient, info);
          });

          await client.login(token);
          this.workers.push(workerClient);

          console.log(`[WorkersManager] Worker ${index + 1} initialized successfully`);
        } catch (error) {
          console.error(`[WorkersManager] Failed to initialize worker ${index + 1}:`, error);
        }
      });

      await Promise.allSettled(initPromises);

      const readyPromises = this.workers.map((worker) => this.waitForWorkerReady(worker));
      await Promise.all(readyPromises);

      if (!this.workers.some((worker) => worker.isReady)) {
        console.warn('[WorkersManager] No ready workers available, falling back to main client');
        this.isEnabled = false;
        return;
      }

      console.log(`[WorkersManager] ${this.workers.filter((worker) => worker.isReady).length} workers ready`);

      this.startProcessing();
      this.startHealthCheck();
    } catch (error) {
      console.error('[WorkersManager] Failed to initialize workers:', error);
      this.isEnabled = false;
    }
  }

  private createWorkerClient(client: Client): WorkerClient {
    return {
      client,
      isReady: false,
      stats: {
        tasksProcessed: 0,
        tasksSucceeded: 0,
        tasksFailed: 0,
        averageProcessingTime: 0,
        lastActiveAt: 0,
        rateLimitHits: 0,
      },
      currentTasks: new Set(),
      rateLimitedUntil: 0,
      routeCooldowns: new Map(),
      routeLastAssignedAt: new Map(),
      activeRoutes: new Map(),
      activeByType: new Map(),
      typeLatency: new Map(),
      tokens: TASK_BURST,
      lastTokenRefill: Date.now(),
      lastAssignedAt: 0,
      lastRateLimitAt: 0,
    };
  }

  private hydrateWorker(worker: WorkerClient): void {
    if (!(worker.routeCooldowns instanceof Map)) worker.routeCooldowns = new Map();
    if (!(worker.routeLastAssignedAt instanceof Map)) worker.routeLastAssignedAt = new Map();
    if (!(worker.activeRoutes instanceof Map)) worker.activeRoutes = new Map();
    if (!(worker.activeByType instanceof Map)) worker.activeByType = new Map();
    if (!(worker.typeLatency instanceof Map)) worker.typeLatency = new Map();
    if (typeof worker.tokens !== 'number' || Number.isNaN(worker.tokens)) worker.tokens = TASK_BURST;
    if (typeof worker.lastTokenRefill !== 'number') worker.lastTokenRefill = Date.now();
    if (typeof worker.lastAssignedAt !== 'number') worker.lastAssignedAt = 0;
    if (typeof worker.lastRateLimitAt !== 'number') worker.lastRateLimitAt = 0;
    if (typeof worker.rateLimitedUntil !== 'number') worker.rateLimitedUntil = 0;
  }

  private startProcessing(): void {
    if (this.processingInterval) return;
    this.processingInterval = setInterval(() => {
      this.processTasks().catch((error) => {
        console.error('[WorkersManager] Task processing error:', error);
      });
    }, PROCESSING_INTERVAL);
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) return;
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL);
  }

  private refillTokens(worker: WorkerClient, now: number): void {
    const elapsed = now - worker.lastTokenRefill;
    if (elapsed <= 0) return;
    worker.tokens = Math.min(TASK_BURST, worker.tokens + (elapsed * TASK_RATE_PER_SECOND) / 1000);
    worker.lastTokenRefill = now;
  }

  private taskRouteKey(task: WorkerTask): string {
    if (task.type === 'message_send') {
      return `message:${String(task.data.channelId ?? 'unknown')}`;
    }
    if (task.type === 'channel_create' || task.type === 'channel_delete' || task.type === 'channel_status') {
      return 'channel:guild';
    }
    return 'member:guild';
  }

  private rateLimitKey(info: RateLimitInfo): string {
    const url = String(info.url ?? info.route ?? '');
    if (url.includes('/messages')) {
      return `message:${String(info.majorParameter ?? 'unknown')}`;
    }
    if (url.includes('/members')) return 'member:guild';
    if (url.includes('/channels')) return 'channel:guild';
    return 'guild';
  }

  private routeInterval(task: WorkerTask): number {
    if (task.type === 'message_send') return MESSAGE_ROUTE_INTERVAL_MS;
    if (task.type === 'channel_create' || task.type === 'channel_delete' || task.type === 'channel_status') {
      return CHANNEL_ROUTE_INTERVAL_MS;
    }
    return MEMBER_ROUTE_INTERVAL_MS;
  }

  private normalizeRateLimitWait(value: unknown, secondsWhenSmall = false): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RATE_LIMIT_WAIT_MS;
    const milliseconds = secondsWhenSmall && parsed < 100 ? parsed * 1000 : parsed;
    return Math.max(250, Math.min(60000, Math.ceil(milliseconds)));
  }

  private applyRateLimit(
    worker: WorkerClient,
    routeKey: string,
    waitMs: number,
    global: boolean,
  ): void {
    const now = Date.now();
    const wait = this.normalizeRateLimitWait(waitMs);
    this.hydrateWorker(worker);
    if (now - worker.lastRateLimitAt > 100) worker.stats.rateLimitHits += 1;
    worker.lastRateLimitAt = now;

    if (global) {
      worker.rateLimitedUntil = Math.max(worker.rateLimitedUntil, now + wait);
    } else if (routeKey === 'guild') {
      worker.routeCooldowns.set(
        'channel:guild',
        Math.max(worker.routeCooldowns.get('channel:guild') ?? 0, now + wait),
      );
      worker.routeCooldowns.set(
        'member:guild',
        Math.max(worker.routeCooldowns.get('member:guild') ?? 0, now + wait),
      );
    } else {
      worker.routeCooldowns.set(
        routeKey,
        Math.max(worker.routeCooldowns.get(routeKey) ?? 0, now + wait),
      );
    }

    console.warn(
      `[WorkersManager] Rate limit on ${worker.client.user?.tag ?? 'worker'} for ${wait}ms (${global ? 'global' : routeKey})`,
    );
  }

  private handleRateLimit(worker: WorkerClient, info: RateLimitInfo): void {
    const wait = this.normalizeRateLimitWait(
      Math.max(Number(info.retryAfter) || 0, Number(info.timeToReset) || 0),
    );
    this.applyRateLimit(worker, this.rateLimitKey(info), wait, info.global === true);
  }

  private applyRateLimitError(worker: WorkerClient, task: WorkerTask, error: unknown): void {
    const record = this.asErrorRecord(error);
    const rawError = record?.rawError;
    const global = record?.global === true || rawError?.global === true;
    const candidates = [record?.retryAfter, rawError?.retry_after, record?.timeToReset]
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => (value < 100 ? value * 1000 : value));
    const wait = this.normalizeRateLimitWait(candidates.length > 0 ? Math.max(...candidates) : 0);
    this.applyRateLimit(worker, this.taskRouteKey(task), wait, global);
  }

  private hydrateWorkers(now: number): void {
    for (const worker of this.workers) {
      this.hydrateWorker(worker);
      this.refillTokens(worker, now);
    }
  }

  private workerHasCapacity(worker: WorkerClient, now: number): boolean {
    this.hydrateWorker(worker);
    this.refillTokens(worker, now);
    return (
      worker.isReady &&
      now >= worker.rateLimitedUntil &&
      worker.currentTasks.size < MAX_CONCURRENT_TASKS_PER_WORKER &&
      worker.tokens >= 1
    );
  }

  private workerCanHandleTask(worker: WorkerClient, task: WorkerTask, now: number): boolean {
    if (!this.workerHasCapacity(worker, now)) return false;
    const routeKey = this.taskRouteKey(task);
    if (now < (worker.routeCooldowns.get(routeKey) ?? 0)) return false;
    const lastAssigned = worker.routeLastAssignedAt.get(routeKey) ?? 0;
    return now - lastAssigned >= this.routeInterval(task);
  }

  private reserveWorker(worker: WorkerClient, task: WorkerTask, now: number): void {
    const routeKey = this.taskRouteKey(task);
    this.hydrateWorker(worker);
    worker.tokens = Math.max(0, worker.tokens - 1);
    worker.currentTasks.add(task.id);
    worker.routeLastAssignedAt.set(routeKey, now);
    worker.activeRoutes.set(routeKey, (worker.activeRoutes.get(routeKey) ?? 0) + 1);
    worker.activeByType.set(task.type, (worker.activeByType.get(task.type) ?? 0) + 1);
    worker.lastAssignedAt = now;
  }

  private releaseWorker(worker: WorkerClient, task: WorkerTask): void {
    const routeKey = this.taskRouteKey(task);
    const routeLoad = (worker.activeRoutes.get(routeKey) ?? 1) - 1;
    if (routeLoad > 0) worker.activeRoutes.set(routeKey, routeLoad);
    else worker.activeRoutes.delete(routeKey);

    const typeLoad = (worker.activeByType.get(task.type) ?? 1) - 1;
    if (typeLoad > 0) worker.activeByType.set(task.type, typeLoad);
    else worker.activeByType.delete(task.type);
  }

  private scoreWorker(
    worker: WorkerClient,
    task: WorkerTask,
    demand: Map<WorkerTaskType, number>,
    now: number,
  ): number {
    const routeKey = this.taskRouteKey(task);
    const loadRatio = worker.currentTasks.size / MAX_CONCURRENT_TASKS_PER_WORKER;
    const typeLoad = worker.activeByType.get(task.type) ?? 0;
    const demandCount = demand.get(task.type) ?? 0;
    const demandWeight = 1 + Math.min(3, demandCount) / 3;
    const routeLoad = worker.activeRoutes.get(routeKey) ?? 0;
    const latency = worker.typeLatency.get(task.type) ?? worker.stats.averageProcessingTime;
    const latencyScore = latency > 0 ? Math.min(1.5, latency / 2500) : 0.2;
    const recentRateLimit = now - worker.lastRateLimitAt < RATE_LIMIT_MEMORY_MS ? 1 : 0;
    const recentAssignment = now - worker.lastAssignedAt < 100 ? 0.25 : 0;

    return (
      loadRatio * 100 +
      typeLoad * 40 * demandWeight +
      routeLoad * 60 +
      latencyScore * 15 +
      recentRateLimit * 35 +
      recentAssignment +
      Math.min(2, worker.stats.tasksProcessed * 0.001)
    );
  }

  private pickWorker(
    workers: WorkerClient[],
    task: WorkerTask,
    demand: Map<WorkerTaskType, number>,
    now: number,
  ): WorkerClient {
    let selected = workers[0];
    let selectedScore = Number.POSITIVE_INFINITY;
    for (const worker of workers) {
      const score = this.scoreWorker(worker, task, demand, now);
      if (score < selectedScore) {
        selected = worker;
        selectedScore = score;
      }
    }
    return selected;
  }

  private collectQueuedTasks(): WorkerTask[] {
    const tasks: WorkerTask[] = [];
    for (let priority = 10; priority >= 0; priority -= 1) {
      const queue = this.taskQueue.get(priority);
      if (!queue) continue;
      for (const task of queue) {
        if (task.state === 'queued') tasks.push(task);
      }
    }
    return tasks;
  }

  private collectDemand(tasks: WorkerTask[]): Map<WorkerTaskType, number> {
    const demand = new Map<WorkerTaskType, number>();
    for (const task of tasks) {
      demand.set(task.type, (demand.get(task.type) ?? 0) + 1);
    }
    return demand;
  }

  private taskRank(task: WorkerTask, now: number): number {
    const ageSeconds = Math.max(0, (now - task.timestamp) / 1000);
    return task.priority + Math.min(10, ageSeconds / 3);
  }

  private detachTask(task: WorkerTask): boolean {
    const queue = this.taskQueue.get(task.priority);
    if (!queue) return false;
    const index = queue.indexOf(task);
    if (index < 0) return false;
    queue.splice(index, 1);
    this.queuedTaskCount = Math.max(0, this.queuedTaskCount - 1);
    return true;
  }

  private async processTasks(): Promise<void> {
    if (!this.isEnabled || this.workers.length === 0) return;
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      this.hydrateWorkers(now);
      const readyWorkers = this.workers.filter((worker) => worker.isReady);
      if (readyWorkers.length === 0) return;

      const tasks = this.collectQueuedTasks();
      if (tasks.length === 0) return;

      const demand = this.collectDemand(tasks);
      tasks.sort((a, b) => this.taskRank(b, now) - this.taskRank(a, now));

      let assigned = 0;
      const maxAssignments = Math.max(1, readyWorkers.length * MAX_CONCURRENT_TASKS_PER_WORKER * 2);

      while (assigned < maxAssignments) {
        const candidates = readyWorkers.filter((worker) => this.workerHasCapacity(worker, now));
        if (candidates.length === 0) break;

        let assignedThisRound = false;
        for (const task of tasks) {
          if (task.state !== 'queued') continue;
          const eligible = candidates.filter((worker) => this.workerCanHandleTask(worker, task, now));
          if (eligible.length === 0) continue;

          const worker = this.pickWorker(eligible, task, demand, now);
          if (!this.detachTask(task)) continue;

          this.reserveWorker(worker, task, now);
          assigned += 1;
          assignedThisRound = true;
          this.executeTask(worker, task).catch((error) => {
            console.error(`[WorkersManager] Unhandled task error ${task.id}:`, error);
          });
          break;
        }

        if (!assignedThisRound) break;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeTask(worker: WorkerClient, task: WorkerTask): Promise<void> {
    const startTime = Date.now();
    this.hydrateWorker(worker);
    task.state = 'running';
    worker.currentTasks.add(task.id);
    this.processingTasks.set(task.id, task);
    this.clearTaskTimeout(task);

    try {
      let result: unknown;

      switch (task.type) {
        case 'channel_create':
          result = await this.executeChannelCreate(worker.client, task.data);
          break;
        case 'channel_delete':
          result = await this.executeChannelDelete(worker.client, task.data);
          break;
        case 'channel_status':
          result = await this.executeChannelStatus(worker.client, task.data);
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
          throw new Error(`Unknown task type: ${String(task.type)}`);
      }

      this.recordTaskCompletion(worker, startTime, true, task.type);
      this.consecutiveFailures.set(worker, 0);
      task.state = 'done';
      task.resolve?.(result);
    } catch (error) {
      if (this.isRateLimitError(error)) {
        this.applyRateLimitError(worker, task, error);
        this.requeueTask(worker, task, error, false);
      } else if (this.isPermissionError(error)) {
        const fallbackHandled = await this.fallbackToMainClient(worker, task, startTime);
        if (!fallbackHandled) {
          this.handleTaskFailure(worker, task, error);
        }
      } else {
        this.handleTaskFailure(worker, task, error);
      }
    } finally {
      worker.currentTasks.delete(task.id);
      this.processingTasks.delete(task.id);
      this.releaseWorker(worker, task);
      if (task.state === 'running') task.state = 'done';
    }
  }

  private async fallbackToMainClient(
    worker: WorkerClient,
    task: WorkerTask,
    startTime: number,
  ): Promise<boolean> {
    try {
      const fallbackResult = await this.executeTaskOnMainClient(task.type, task.data);
      this.recordTaskCompletion(worker, startTime, true, task.type);
      this.consecutiveFailures.set(worker, 0);
      task.state = 'done';
      task.resolve?.(fallbackResult);
      return true;
    } catch (mainError) {
      if (this.isPermissionError(mainError)) {
        worker.stats.tasksProcessed += 1;
        worker.stats.tasksSucceeded += 1;
        worker.stats.lastActiveAt = Date.now();
        task.state = 'done';
        task.resolve?.(undefined);
        return true;
      }
      console.error(`[WorkersManager] Task ${task.id} failed on main client:`, mainError);
      return false;
    }
  }

  private handleTaskFailure(worker: WorkerClient, task: WorkerTask, error: unknown): void {
    const failures = (this.consecutiveFailures.get(worker) ?? 0) + 1;
    this.consecutiveFailures.set(worker, failures);

    if (failures >= FAILURE_QUARANTINE_THRESHOLD) {
      worker.rateLimitedUntil = Math.max(worker.rateLimitedUntil, Date.now() + FAILURE_QUARANTINE_MS);
      this.consecutiveFailures.set(worker, 0);
    }

    console.error(`[WorkersManager] Task ${task.id} failed:`, error);
    this.requeueTask(worker, task, error, true);
  }

  private requeueTask(
    worker: WorkerClient,
    task: WorkerTask,
    error: unknown,
    penalizePriority: boolean,
  ): void {
    if (task.retries >= MAX_RETRIES) {
      task.state = 'done';
      worker.stats.tasksProcessed += 1;
      worker.stats.tasksFailed += 1;
      worker.stats.lastActiveAt = Date.now();
      task.reject?.(error);
      return;
    }

    task.retries += 1;
    if (penalizePriority) task.priority = Math.max(0, task.priority - 1);
    task.state = 'queued';
    this.armTaskTimeout(task);
    this.taskQueue.get(task.priority)?.push(task);
    this.queuedTaskCount += 1;

    console.log(
      `[WorkersManager] Retrying task ${task.id} (attempt ${task.retries}/${MAX_RETRIES})`,
    );
  }

  private armTaskTimeout(task: WorkerTask): void {
    this.clearTaskTimeout(task);
    task.timeout = setTimeout(() => this.handleTaskTimeout(task), TASK_TIMEOUT);
  }

  private clearTaskTimeout(task: WorkerTask): void {
    if (task.timeout) {
      clearTimeout(task.timeout);
      task.timeout = undefined;
    }
  }

  private handleTaskTimeout(task: WorkerTask): void {
    if (task.state !== 'queued') return;
    task.state = 'done';
    this.detachTask(task);
    task.reject?.(new Error(`Task timeout (${task.type})`));
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
    return code === 50013 || code === 50001 || status === 403 || msg.includes('missing permissions');
  }

  private isRateLimitError(error: unknown): boolean {
    const err = this.asErrorRecord(error);
    if (!err) return false;
    return err.code === 429 || err.status === 429 || err.rawError?.code === 429;
  }

  private asErrorRecord(error: unknown): {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    retryAfter?: unknown;
    timeToReset?: unknown;
    global?: unknown;
    rawError?: { code?: unknown; retry_after?: unknown; global?: unknown };
  } | null {
    if (typeof error !== 'object' || error === null) return null;
    return error as {
      code?: unknown;
      status?: unknown;
      message?: unknown;
      retryAfter?: unknown;
      timeToReset?: unknown;
      global?: unknown;
      rawError?: { code?: unknown; retry_after?: unknown; global?: unknown };
    };
  }

  private recordTaskCompletion(
    worker: WorkerClient,
    startTime: number,
    success: boolean,
    type: WorkerTaskType,
  ): void {
    const processingTime = Date.now() - startTime;
    worker.stats.tasksProcessed += 1;
    if (success) worker.stats.tasksSucceeded += 1;
    worker.stats.lastActiveAt = Date.now();
    worker.stats.averageProcessingTime = worker.stats.averageProcessingTime === 0
      ? processingTime
      : worker.stats.averageProcessingTime * 0.7 + processingTime * 0.3;

    const previousLatency = worker.typeLatency.get(type) ?? 0;
    worker.typeLatency.set(
      type,
      previousLatency === 0 ? processingTime : previousLatency * 0.7 + processingTime * 0.3,
    );
  }

  private async executeChannelDelete(client: Client, data: WorkerTaskData): Promise<void> {
    const guild = client.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');
    const channel = guild.channels.cache.get(data.channelId as string);
    if (channel) await channel.delete();
  }

  private async executeChannelStatus(client: Client, data: WorkerTaskData): Promise<void> {
    const channelId = data.channelId as string;
    if (!channelId) throw new Error('Channel id is required');
    await client.rest.put(`/channels/${channelId}/voice-status`, {
      body: { status: data.status as string | null },
      reason: 'Queue channel status update',
    });
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
    if (member) await member.setNickname(data.nickname as string | null);
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

    if (add.length > 0) await member.roles.add(add);
    if (remove.length > 0) await member.roles.remove(remove);
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
    let coolingRoutes = 0;

    for (const worker of this.workers) {
      this.hydrateWorker(worker);
      if (now < worker.rateLimitedUntil) quarantined += 1;
      else this.consecutiveFailures.delete(worker);

      for (const [key, until] of worker.routeCooldowns) {
        if (until <= now) worker.routeCooldowns.delete(key);
        else coolingRoutes += 1;
      }

      for (const [key, assignedAt] of worker.routeLastAssignedAt) {
        if (now - assignedAt > ROUTE_IDLE_CLEANUP_MS) worker.routeLastAssignedAt.delete(key);
      }
    }

    if (quarantined > 0 || coolingRoutes > 0 || this.queuedTaskCount > 0) {
      console.log(
        `[WorkersManager] Health: queued=${this.queuedTaskCount} active=${this.processingTasks.size} quarantined=${quarantined} coolingRoutes=${coolingRoutes}`,
      );
    }
  }

  public getQueueDepth(): number {
    return this.queuedTaskCount;
  }

  public getStatus(): {
    enabled: boolean;
    queued: number;
    active: number;
    workers: Array<{
      ready: boolean;
      active: number;
      tokens: number;
      cooldownMs: number;
      coolingRoutes: number;
      rateLimitHits: number;
      averageProcessingTime: number;
    }>;
  } {
    const now = Date.now();
    return {
      enabled: this.isEnabled,
      queued: this.queuedTaskCount,
      active: this.processingTasks.size,
      workers: this.workers.map((worker) => {
        this.hydrateWorker(worker);
        this.refillTokens(worker, now);
        return {
          ready: worker.isReady,
          active: worker.currentTasks.size,
          tokens: Math.round(worker.tokens * 100) / 100,
          cooldownMs: Math.max(0, worker.rateLimitedUntil - now),
          coolingRoutes: Array.from(worker.routeCooldowns.values()).filter((until) => until > now).length,
          rateLimitHits: worker.stats.rateLimitHits,
          averageProcessingTime: Math.round(worker.stats.averageProcessingTime),
        };
      }),
    };
  }

  public async createChannel<T extends { id: string } = { id: string }>(
    options: GuildChannelCreateOptions,
    priority: number = 9,
  ): Promise<T> {
    return this.addTask<T>('channel_create', { options }, priority);
  }

  public async deleteChannel(channelId: string, priority: number = 3): Promise<void> {
    await this.addTask<void>('channel_delete', { channelId }, priority);
  }

  public async setChannelStatus(channelId: string, status: string | null, priority: number = 3): Promise<void> {
    await this.addTask<void>('channel_status', { channelId, status }, priority);
  }

  public async moveMembers(
    memberIds: string[],
    channelId: string,
    priority: number = 8,
  ): Promise<PromiseSettledResult<void>[]> {
    const promises = memberIds.map((memberId) =>
      this.addTask<void>('member_move', { memberId, channelId }, priority),
    );
    return Promise.allSettled(promises);
  }

  public async setMemberNickname(memberId: string, nickname: string, priority: number = 4): Promise<void> {
    await this.addTask<void>('member_nickname', { memberId, nickname }, priority);
  }

  public async updateMemberRoles(
    memberId: string,
    add: string[] = [],
    remove: string[] = [],
    priority: number = 6,
  ): Promise<void> {
    await this.addTask<void>('member_roles', { memberId, add, remove }, priority);
  }

  public async sendMessage(
    channelId: string,
    message: string | MessageCreateOptions,
    priority: number = 8,
  ): Promise<unknown> {
    return this.addTask('message_send', { channelId, message }, priority);
  }

  private addTask<T = unknown>(
    type: WorkerTaskType,
    data: WorkerTaskData,
    priority: number,
  ): Promise<T> {
    if (!this.isEnabled) {
      return this.executeTaskOnMainClient(type, data) as Promise<T>;
    }

    if (this.workers.length > 0 && !this.workers.some((worker) => worker.isReady)) {
      return this.executeTaskOnMainClient(type, data) as Promise<T>;
    }

    if (this.queuedTaskCount >= MAX_QUEUE_SIZE) {
      return Promise.reject(new Error(`Worker task queue is full (${type})`));
    }

    return new Promise<T>((resolve, reject) => {
      const task: WorkerTask = {
        id: `task_${++this.taskIdCounter}`,
        type,
        priority: Math.max(0, Math.min(10, priority)),
        data,
        retries: 0,
        timestamp: Date.now(),
        state: 'queued',
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      this.armTaskTimeout(task);
      this.taskQueue.get(task.priority)?.push(task);
      this.queuedTaskCount += 1;
    });
  }

  public shutdown(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    for (const queue of this.taskQueue.values()) {
      for (const task of queue) {
        if (task.timeout) clearTimeout(task.timeout);
        task.timeout = undefined;
        task.state = 'done';
      }
      queue.length = 0;
    }
    for (const task of this.processingTasks.values()) {
      if (task.timeout) clearTimeout(task.timeout);
      task.timeout = undefined;
    }
    this.processingTasks.clear();
    this.queuedTaskCount = 0;
  }

  private async executeTaskOnMainClient(
    type: WorkerTaskType,
    data: WorkerTaskData,
  ): Promise<unknown> {
    const guild = this.mainClient.guilds.cache.first();
    if (!guild) throw new Error('Guild not found');
    try {
      switch (type) {
        case 'channel_create':
          return await this.executeChannelCreate(this.mainClient, data);
        case 'channel_delete':
          return await this.executeChannelDelete(this.mainClient, data);
        case 'channel_status':
          return await this.executeChannelStatus(this.mainClient, data);
        case 'member_move':
          return await this.executeMemberMove(this.mainClient, data);
        case 'member_nickname':
          return await this.executeMemberNickname(this.mainClient, data);
        case 'member_roles':
          return await this.executeMemberRoles(this.mainClient, data);
        case 'message_send':
          return await this.executeMessageSend(this.mainClient, data);
      }
    } catch (error) {
      if (this.isPermissionError(error)) return;
      throw error;
    }
  }
}
