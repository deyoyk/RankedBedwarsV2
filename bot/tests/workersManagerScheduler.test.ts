import { WorkersManager } from '../src/managers/WorkersManager';

const mainClientMock: any = {
  guilds: { cache: { first: () => undefined } },
  channels: { cache: { get: () => undefined } },
};

function makeManager(): WorkersManager {
  return new (WorkersManager as any)(mainClientMock);
}

function makeWorker(name: string, ready = true): any {
  const sent: Array<{ channelId: string; message: unknown }> = [];
  const guild = {
    channels: {
      cache: {
        get: (channelId: string) => ({
          isTextBased: () => true,
          send: async (message: unknown) => {
            sent.push({ channelId, message });
            return { id: `${name}-${sent.length}` };
          },
        }),
      },
    },
    members: { cache: { get: () => undefined } },
  };

  return {
    name,
    sent,
    client: { guilds: { cache: { first: () => guild } } },
    isReady: ready,
    currentTasks: new Set<string>(),
    rateLimitedUntil: 0,
    stats: {
      tasksProcessed: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      averageProcessingTime: 0,
      lastActiveAt: 0,
      rateLimitHits: 0,
    },
  };
}

function enable(manager: WorkersManager, workers: any[]): void {
  (manager as any).isEnabled = true;
  (manager as any).workers = workers;
}

describe('WorkersManager demand-aware scheduler', () => {
  it('routes messages through workers instead of the main client', async () => {
    const manager = makeManager();
    const worker = makeWorker('worker-1');
    enable(manager, [worker]);

    const promise = manager.sendMessage('channel-1', 'hello', 8);
    expect(manager.getQueueDepth()).toBe(1);

    await (manager as any).processTasks();
    await expect(promise).resolves.toEqual({ id: 'worker-1-1' });
    expect(worker.sent).toEqual([{ channelId: 'channel-1', message: 'hello' }]);
  });

  it('spreads independent routes across idle workers', async () => {
    const manager = makeManager();
    const workers = [makeWorker('worker-1'), makeWorker('worker-2'), makeWorker('worker-3')];
    enable(manager, workers);

    const promises = [
      manager.sendMessage('channel-a', 'a', 8),
      manager.sendMessage('channel-b', 'b', 8),
      manager.sendMessage('channel-c', 'c', 8),
    ];

    await (manager as any).processTasks();
    await Promise.all(promises);

    expect(workers.every((worker) => worker.sent.length === 1)).toBe(true);
  });

  it('isolates a channel rate limit to the affected worker and route', async () => {
    const manager = makeManager();
    const workers = [makeWorker('worker-1'), makeWorker('worker-2')];
    enable(manager, workers);

    const promise = manager.sendMessage('hot-channel', 'hello', 8);
    const task = (manager as any).taskQueue.get(8)[0];

    (manager as any).handleRateLimit(workers[0], {
      global: false,
      url: '/channels/hot-channel/messages',
      majorParameter: 'hot-channel',
      retryAfter: 5000,
      timeToReset: 5000,
    });

    expect(workers[0].routeCooldowns.get('message:hot-channel')).toBeGreaterThan(Date.now());
    expect((manager as any).workerCanHandleTask(workers[0], task, Date.now())).toBe(false);
    expect((manager as any).workerCanHandleTask(workers[1], task, Date.now())).toBe(true);

    await (manager as any).processTasks();
    await expect(promise).resolves.toBeDefined();
    expect(workers[1].sent).toEqual([{ channelId: 'hot-channel', message: 'hello' }]);
  });

  it('quarantines a worker globally for global rate limits', async () => {
    const manager = makeManager();
    const worker = makeWorker('worker-1');
    enable(manager, [worker]);

    (manager as any).handleRateLimit(worker, {
      global: true,
      retryAfter: 5000,
      timeToReset: 5000,
    });

    expect(worker.rateLimitedUntil).toBeGreaterThan(Date.now());
    expect((manager as any).workerHasCapacity(worker, Date.now())).toBe(false);
  });

  it('rejects new work when the queue is saturated', async () => {
    const manager = makeManager();
    enable(manager, [makeWorker('worker-1')]);
    (manager as any).queuedTaskCount = 500;

    await expect(manager.sendMessage('channel-1', 'hello', 8)).rejects.toThrow('queue is full');
  });

  it('ages low-priority cleanup work ahead of a sustained high-priority flood', () => {
    const manager = makeManager();
    const now = Date.now();
    const oldCleanup = { priority: 2, timestamp: now - 30000 };
    const freshMessage = { priority: 8, timestamp: now };

    expect((manager as any).taskRank(oldCleanup, now)).toBeGreaterThan(
      (manager as any).taskRank(freshMessage, now),
    );
  });

  it('falls back to the main client when no worker is ready', async () => {
    const manager = makeManager();
    enable(manager, [makeWorker('worker-1', false)]);

    await expect(manager.sendMessage('channel-1', 'hello', 8)).rejects.toThrow('Guild not found');
    expect(manager.getQueueDepth()).toBe(0);
  });
});
