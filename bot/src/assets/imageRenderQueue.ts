import os from 'os';
import { Worker } from 'worker_threads';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadImageFonts, type ImageFont } from './assets';
import type { VNode } from './renderer';

export type RenderOptions = {
  timeoutMs?: number;
  priority?: 'high' | 'normal';
};

type SatoriRenderFn = (
  element: VNode,
  options: { width: number; height: number; fonts: ImageFont[] },
) => Promise<string>;

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; id: number; png: Uint8Array }
  | { type: 'error'; id: number; error: string };

type JobState = 'queued' | 'running' | 'done';

type Job = {
  id: number;
  root: VNode;
  width: number;
  height: number;
  priority: 'high' | 'normal';
  state: JobState;
  timer: NodeJS.Timeout | null;
  slot: WorkerSlot | null;
  workerResolve: ((buffer: Buffer) => void) | null;
  workerReject: ((error: Error) => void) | null;
  resolve: (buffer: Buffer) => void;
  reject: (error: Error) => void;
};

export class ImageRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRenderError';
  }
}

export class ImageRenderOverloadedError extends ImageRenderError {
  constructor() {
    super('Image render queue is full');
    this.name = 'ImageRenderOverloadedError';
  }
}

export class ImageRenderTimeoutError extends ImageRenderError {
  constructor() {
    super('Image render timed out');
    this.name = 'ImageRenderTimeoutError';
  }
}

class RenderJobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderJobFailure';
  }
}

const importedModule = satori as unknown as SatoriRenderFn | { default: SatoriRenderFn };
const renderSvg: SatoriRenderFn =
  typeof importedModule === 'function' ? importedModule : importedModule.default;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const CPU_COUNT = (() => {
  try {
    return typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length;
  } catch {
    return 1;
  }
})();

const DEFAULT_WORKERS = CPU_COUNT > 1 ? Math.min(2, CPU_COUNT - 1) : 1;
const WORKER_COUNT = intEnv('IMAGE_RENDER_WORKERS', DEFAULT_WORKERS, 0, 8);
const WORKERS_ENABLED = WORKER_COUNT > 0;
const MAX_ACTIVE = WORKERS_ENABLED ? WORKER_COUNT : 1;
const QUEUE_LIMIT = intEnv('IMAGE_RENDER_QUEUE_LIMIT', 64, 1, 1000);
const HIGH_PRIORITY_QUEUE_LIMIT = intEnv('IMAGE_RENDER_HIGH_QUEUE_LIMIT', 16, 1, 1000);
const DEFAULT_TIMEOUT_MS = intEnv('IMAGE_RENDER_TIMEOUT_MS', 20000, 1000, 120000);
const WORKER_READY_TIMEOUT_MS = intEnv('IMAGE_RENDER_WORKER_READY_MS', 15000, 1000, 60000);
const MAX_JOBS_PER_WORKER = intEnv('IMAGE_RENDER_WORKER_JOBS', 100, 1, 10000);
const WORKER_COOLDOWN_MS = intEnv('IMAGE_RENDER_WORKER_COOLDOWN_MS', 60000, 1000, 600000);
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16000000;

const WORKER_SOURCE = `
const { parentPort } = require('worker_threads');
const satoriModule = require('satori');
const { Resvg } = require('@resvg/resvg-js');
const satori = typeof satoriModule === 'function' ? satoriModule : satoriModule.default;
let fonts = [];
parentPort.on('message', async (message) => {
  if (message.type === 'init') {
    fonts = Array.isArray(message.fonts)
      ? message.fonts.map((font) => ({ ...font, data: Buffer.from(font.data) }))
      : [];
    parentPort.postMessage({ type: 'ready' });
    return;
  }
  if (message.type !== 'render') return;
  try {
    const svg = await satori(message.root, {
      width: message.width,
      height: message.height,
      fonts
    });
    const png = Buffer.from(new Resvg(svg, {
      fitTo: { mode: 'width', value: message.width }
    }).render().asPng());
    parentPort.postMessage({ type: 'result', id: message.id, png });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      id: message.id,
      error: error && error.stack ? error.stack : String(error)
    });
  }
});
`;

class WorkerSlot {
  alive = true;
  busy = false;
  jobs = 0;
  private currentJob: Job | null = null;
  private readonly worker: Worker;
  private readonly ready: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private readySettled = false;
  private readyTimer: NodeJS.Timeout | null = null;

  constructor(fonts: ImageFont[]) {
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 64,
      },
    });
    this.worker.ref();
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    void this.ready.catch(() => undefined);
    this.readyTimer = setTimeout(() => {
      this.fail(new Error('Image worker startup timed out'));
    }, WORKER_READY_TIMEOUT_MS);
    this.worker.on('message', (message: WorkerMessage) => this.handleMessage(message));
    this.worker.on('error', (error: Error) => this.fail(error));
    this.worker.on('exit', (code: number) => {
      this.fail(new Error(`Image worker exited with code ${code}`));
    });
    this.worker.postMessage({ type: 'init', fonts });
  }

  private handleMessage(message: WorkerMessage): void {
    if (message.type === 'ready') {
      if (!this.alive) return;
      this.settleReady();
      if (!this.currentJob) this.worker.unref();
      return;
    }

    const job = this.currentJob;
    if (!job || job.id !== message.id) return;

    this.currentJob = null;
    this.jobs += 1;

    if (message.type === 'result') {
      const resolve = job.workerResolve;
      job.workerResolve = null;
      job.workerReject = null;
      resolve?.(Buffer.from(message.png));
    } else {
      const reject = job.workerReject;
      job.workerResolve = null;
      job.workerReject = null;
      reject?.(new RenderJobFailure(message.error));
    }

    this.worker.unref();
    if (this.jobs >= MAX_JOBS_PER_WORKER) this.retire();
  }

  private settleReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    const resolve = this.readyResolve;
    this.readyResolve = null;
    this.readyReject = null;
    resolve?.();
  }

  private fail(error: Error): void {
    const wasAlive = this.alive;
    this.alive = false;

    if (!this.readySettled) {
      this.readySettled = true;
      if (this.readyTimer) {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      const reject = this.readyReject;
      this.readyResolve = null;
      this.readyReject = null;
      reject?.(error);
    }

    const job = this.currentJob;
    if (job) {
      this.currentJob = null;
      const reject = job.workerReject;
      job.workerResolve = null;
      job.workerReject = null;
      reject?.(error);
    }

    this.worker.unref();
    if (wasAlive) {
      void this.worker.terminate().catch(() => undefined);
    }
  }

  async render(job: Job): Promise<Buffer> {
    if (this.busy) throw new Error('Image worker is busy');
    this.busy = true;
    job.slot = this;

    try {
      await this.ready;
      if (!this.alive) throw new Error('Image worker is unavailable');
      this.worker.ref();

      return await new Promise<Buffer>((resolve, reject) => {
        this.currentJob = job;
        job.workerResolve = resolve;
        job.workerReject = reject;
        this.worker.postMessage({
          type: 'render',
          id: job.id,
          root: job.root,
          width: job.width,
          height: job.height,
        });
      });
    } finally {
      if (this.currentJob === job) this.currentJob = null;
      job.workerResolve = null;
      job.workerReject = null;
      job.slot = null;
      this.busy = false;
      this.worker.unref();
      if (this.jobs >= MAX_JOBS_PER_WORKER) this.retire();
    }
  }

  cancel(job: Job): void {
    if (job.slot !== this) return;
    const reject = job.workerReject;
    job.workerResolve = null;
    job.workerReject = null;
    reject?.(new Error('Image render cancelled'));
    this.fail(new Error('Image render cancelled'));
  }

  retire(): void {
    if (!this.alive || this.busy) return;
    this.alive = false;
    this.worker.unref();
    void this.worker.terminate().catch(() => undefined);
  }
}

const highPriorityQueue: Job[] = [];
const normalPriorityQueue: Job[] = [];
const slots: WorkerSlot[] = [];
let activeJobs = 0;
let nextJobId = 1;
let workerFailures = 0;
let workerCooldownUntil = 0;
let inlineChain: Promise<void> = Promise.resolve();

function queuedCount(): number {
  return highPriorityQueue.length + normalPriorityQueue.length;
}

function removeQueuedJob(job: Job): void {
  const highIndex = highPriorityQueue.indexOf(job);
  if (highIndex >= 0) {
    highPriorityQueue.splice(highIndex, 1);
    return;
  }
  const normalIndex = normalPriorityQueue.indexOf(job);
  if (normalIndex >= 0) normalPriorityQueue.splice(normalIndex, 1);
}

function nextQueuedJob(): Job | undefined {
  return highPriorityQueue.shift() ?? normalPriorityQueue.shift();
}

function workersAvailable(): boolean {
  return WORKERS_ENABLED && Date.now() >= workerCooldownUntil;
}

function acquireSlot(): WorkerSlot {
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    if (!slots[i].alive) slots.splice(i, 1);
  }

  const idle = slots.find((slot) => !slot.busy);
  if (idle) return idle;
  if (slots.length >= MAX_ACTIVE) throw new Error('No image worker available');

  const slot = new WorkerSlot(loadImageFonts());
  slots.push(slot);
  return slot;
}

async function renderInline(root: VNode, width: number, height: number): Promise<Buffer> {
  const fonts = loadImageFonts();
  if (fonts.length === 0) throw new Error('No image fonts available');
  const svg = await renderSvg(root, { width, height, fonts });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
}

async function renderInlineLocked(job: Job): Promise<Buffer> {
  const previous = inlineChain;
  let release: () => void = () => undefined;
  inlineChain = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    if (job.state === 'done') throw new ImageRenderTimeoutError();
    return await renderInline(job.root, job.width, job.height);
  } finally {
    release();
  }
}

async function execute(job: Job): Promise<void> {
  try {
    let buffer: Buffer;

    if (workersAvailable()) {
      try {
        const slot = acquireSlot();
        buffer = await slot.render(job);
        workerFailures = 0;
      } catch (error) {
        if (job.state === 'done') return;
        if (error instanceof RenderJobFailure) throw error;
        workerFailures += 1;
        if (workerFailures >= 2) {
          workerFailures = 0;
          workerCooldownUntil = Date.now() + WORKER_COOLDOWN_MS;
        }
        buffer = await renderInlineLocked(job);
      }
    } else {
      buffer = await renderInlineLocked(job);
    }

    if (job.state === 'done') return;
    finish(job, null, buffer);
  } catch (error) {
    if (job.state === 'done') return;
    finish(job, error instanceof Error ? error : new Error(String(error)));
  }
}

function finish(job: Job, error: Error | null, buffer?: Buffer): void {
  if (job.state === 'done') return;
  job.state = 'done';
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  if (error) job.reject(error);
  else job.resolve(buffer as Buffer);
}

function timeoutJob(job: Job): void {
  if (job.state === 'done') return;
  job.state = 'done';
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = null;
  }
  removeQueuedJob(job);
  job.slot?.cancel(job);
  job.reject(new ImageRenderTimeoutError());
}

function pump(): void {
  while (activeJobs < MAX_ACTIVE && queuedCount() > 0) {
    const job = nextQueuedJob();
    if (!job || job.state !== 'queued') continue;
    job.state = 'running';
    activeJobs += 1;
    void execute(job).finally(() => {
      activeJobs -= 1;
      pump();
    });
  }
}

export function getImageRenderStats(): {
  active: number;
  queued: number;
  highPriorityQueued: number;
  normalPriorityQueued: number;
  workers: number;
  workersEnabled: boolean;
} {
  return {
    active: activeJobs,
    queued: queuedCount(),
    highPriorityQueued: highPriorityQueue.length,
    normalPriorityQueued: normalPriorityQueue.length,
    workers: slots.filter((slot) => slot.alive).length,
    workersEnabled: workersAvailable(),
  };
}

export function renderImage(
  root: VNode,
  width: number,
  height: number,
  options: RenderOptions = {},
): Promise<Buffer> {
  if (!root || typeof root !== 'object') {
    return Promise.reject(new ImageRenderError('Invalid image node'));
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Promise.reject(new ImageRenderError('Invalid image dimensions'));
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    return Promise.reject(new ImageRenderError('Image dimensions exceed the safety limit'));
  }

  const priority = options.priority === 'high' ? 'high' : 'normal';
  const queuedForPriority = priority === 'high'
    ? highPriorityQueue.length
    : normalPriorityQueue.length;
  const queueLimitForPriority = priority === 'high' ? HIGH_PRIORITY_QUEUE_LIMIT : QUEUE_LIMIT;
  if (queuedForPriority >= queueLimitForPriority) {
    return Promise.reject(new ImageRenderOverloadedError());
  }

  const timeoutMs = Math.max(
    1000,
    Math.min(120000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
  );

  return new Promise<Buffer>((resolve, reject) => {
    const job: Job = {
      id: nextJobId,
      root,
      width,
      height,
      priority,
      state: 'queued',
      timer: null,
      slot: null,
      workerResolve: null,
      workerReject: null,
      resolve,
      reject,
    };
    nextJobId += 1;
    job.timer = setTimeout(() => timeoutJob(job), timeoutMs);
    if (priority === 'high') highPriorityQueue.push(job);
    else normalPriorityQueue.push(job);
    pump();
  });
}
