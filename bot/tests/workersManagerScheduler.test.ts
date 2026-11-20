import { WorkersManager } from '../src/managers/WorkersManager';

const mainClientMock: any = {
  guilds: { cache: { first: () => undefined } },
  channels: { cache: { get: () => undefined } },
};

function makeManager(mainClient: any = mainClientMock): WorkersManager {
  return new (WorkersManager as any)(mainClient);
}

function makeWorker(name: string, ready = true): any {
  const sent: Array<{ channelId: string; message: unknown }> = [];
  const moved: Array<{ memberId: string; channelId: string }> = [];
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
    members: {
      cache: {
        get: (memberId: string) => ({
          voice: {
            channel: { id: 'somewhere' },
            setChannel: async (channelId: string) => {
              moved.push({ memberId, channelId });
            },
          },
        }),
      },
    },
  };

  return {
    name,
    sent,
    moved,
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
  it('sends messages from the main bot, never a worker', async () => {
    const mainSent: Array<{ channelId: string; message: unknown }> = [];
    const mainClient = {
      guilds: {
        cache: {
          first: () => ({
            channels: {
              cache: {
                get: (channelId: string) => ({
                  isTextBased: () => true,
                  send: async (message: unknown) => {
                    mainSent.push({ channelId, message });
                    return { id: 'main-1' };
                  },
                }),
              },
            },
          }),
        },
      },
    };
    const manager = makeManager(mainClient);
    const worker = makeWorker('worker-1');
    enable(manager, [worker]);

    await expect(manager.sendMessage('channel-1', 'hello', 8)).resolves.toEqual({ id: 'main-1' });
    expect(manager.getQueueDepth()).toBe(0);
    expect(mainSent).toEqual([{ channelId: 'channel-1', message: 'hello' }]);
    expect(worker.sent).toEqual([]);
  });

  it('routes background work through workers instead of the main client', async () => {
    const manager = makeManager();
    const worker = makeWorker('worker-1');
    enable(manager, [worker]);

    const promise = manager.moveMembers(['m1'], 'vc-1', 8);
    expect(manager.getQueueDepth()).toBe(1);

    await (manager as any).processTasks();
    await promise;
    expect(worker.moved).toEqual([{ memberId: 'm1', channelId: 'vc-1' }]);
  });

  it('spreads work across idle workers', async () => {
    const manager = makeManager();
    const workers = [makeWorker('worker-1'), makeWorker('worker-2'), makeWorker('worker-3')];
    enable(manager, workers);

    const promise = manager.moveMembers(['a', 'b', 'c'], 'vc-1', 8);

    await (manager as any).processTasks();
    await promise;

    expect(workers.every((worker) => worker.moved.length === 1)).toBe(true);
  });

  it('isolates a rate limit to the affected worker and route', async () => {
    const manager = makeManager();
    const workers = [makeWorker('worker-1'), makeWorker('worker-2')];
    enable(manager, workers);

    const promise = manager.moveMembers(['m1'], 'vc-1', 8);
    const task = (manager as any).taskQueue.get(8)[0];

    (manager as any).handleRateLimit(workers[0], {
      global: false,
      url: '/guilds/g1/members/m1',
      retryAfter: 5000,
      timeToReset: 5000,
    });

    expect(workers[0].routeCooldowns.get('member:guild')).toBeGreaterThan(Date.now());
    expect((manager as any).workerCanHandleTask(workers[0], task, Date.now())).toBe(false);
    expect((manager as any).workerCanHandleTask(workers[1], task, Date.now())).toBe(true);

    await (manager as any).processTasks();
    await promise;
    expect(workers[1].moved).toEqual([{ memberId: 'm1', channelId: 'vc-1' }]);
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

    await expect(manager.setMemberNickname('m1', 'nick', 8)).rejects.toThrow('queue is full');
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

    await expect(manager.setMemberNickname('m1', 'nick', 8)).rejects.toThrow('Guild not found');
    expect(manager.getQueueDepth()).toBe(0);
  });
});
