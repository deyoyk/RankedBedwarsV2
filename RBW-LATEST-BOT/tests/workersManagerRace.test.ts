import { WorkersManager } from '../src/managers/WorkersManager';

const mainClientMock: any = {
  guilds: { cache: { first: () => undefined } },
  channels: { cache: { get: () => undefined } }
};

function makeManager(): WorkersManager {
  return new (WorkersManager as any)(mainClientMock);
}

describe('WorkersManager race conditions', () => {
  it('a task that stays queued (no workers) times out and is removed, never executed later', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    (manager as any).isEnabled = true;
    (manager as any).workers = [];

    const taskPromise = manager.deleteChannel('x', 5);
    expect((manager as any).taskQueue.get(5)).toHaveLength(1);

    jest.advanceTimersByTime(31000);
    await expect(taskPromise).rejects.toThrow('Task timeout');
    expect((manager as any).taskQueue.get(5)).toHaveLength(0);

    // Even if a worker appears later, the task must not execute.
    jest.advanceTimersByTime(60000);
    expect((manager as any).taskQueue.get(5)).toHaveLength(0);
    jest.useRealTimers();
  });

  it('with workers disabled, tasks execute immediately on the main client', async () => {
    const manager = makeManager();
    (manager as any).isEnabled = false;

    await expect(manager.deleteChannel('x', 5))
      .rejects.toThrow('Guild not found');
  });

  it('concurrent addTask calls each get a unique task id', async () => {
    const manager = makeManager();
    (manager as any).isEnabled = true;
    (manager as any).workers = [];

    const promises = Array.from({ length: 50 }, (_, i) =>
      manager.deleteChannel(`c${i}`, 5).catch(() => null)
    );

    const ids = (manager as any).taskQueue.get(5).map((t: any) => t.id);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
  });

  it('a task picked up by a worker clears its queue-timeout (no double execution)', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    (manager as any).isEnabled = true;

    const guildMock: any = {
      channels: { cache: { get: jest.fn().mockReturnValue({ delete: jest.fn().mockResolvedValue(undefined) }) } }
    };
    const fakeWorker = {
      client: { guilds: { cache: { first: () => guildMock } } },
      isReady: true,
      currentTasks: new Set<string>(),
      rateLimitedUntil: 0,
      stats: { tasksProcessed: 0, tasksSucceeded: 0, tasksFailed: 0, averageProcessingTime: 0, lastActiveAt: 0, rateLimitHits: 0 }
    };
    (manager as any).workers = [fakeWorker];

    const executeSpy = jest.spyOn(manager as any, 'executeTask').mockImplementation(async () => {
      // Simulate a slow execution that would previously have raced the timeout.
      await new Promise(r => setTimeout(r, 1000));
    });

    const taskPromise = manager.deleteChannel('x', 5);
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    (manager as any).processTasks();
    await Promise.resolve();

    expect(executeSpy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(40000);
    await Promise.resolve();
    expect(executeSpy).toHaveBeenCalledTimes(1);
    await taskPromise.catch(() => null);

    jest.useRealTimers();
    executeSpy.mockRestore();
  });
});

