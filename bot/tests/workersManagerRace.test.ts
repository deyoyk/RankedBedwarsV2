import { WorkersManager } from '../src/managers/WorkersManager';
import config from '../src/config/config';

const mainClientMock: any = {
  guilds: { cache: { first: () => undefined } },
  channels: { cache: { get: () => undefined } }
};

const managers: WorkersManager[] = [];

function makeManager(): WorkersManager {
  const manager = new (WorkersManager as any)(mainClientMock) as WorkersManager;
  managers.push(manager);
  return manager;
}

describe('WorkersManager race conditions', () => {
  afterEach(() => {
    for (const manager of managers.splice(0)) {
      manager.shutdown();
    }
  });

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

  it('fetches the guild when it is not in the cache', async () => {
    const guild: any = {
      id: config.guildId,
      channels: { create: jest.fn().mockResolvedValue({ id: 'created' }) }
    };
    const client: any = {
      guilds: {
        cache: { get: () => undefined, first: () => undefined },
        fetch: jest.fn().mockResolvedValue(guild)
      }
    };
    const manager = new (WorkersManager as any)(client) as WorkersManager;
    managers.push(manager);
    (manager as any).isEnabled = false;

    await manager.createChannel({ name: 'test' } as any);

    expect(client.guilds.fetch).toHaveBeenCalledWith(config.guildId);
    expect(guild.channels.create).toHaveBeenCalled();
  });

  it('fetches an uncached member before moving them', async () => {
    const setChannel = jest.fn().mockResolvedValue(undefined);
    const member: any = { voice: { channel: { id: 'old' }, setChannel } };
    const guild: any = {
      members: { cache: new Map(), fetch: jest.fn().mockResolvedValue(member) }
    };
    const client: any = { guilds: { cache: { get: () => guild, first: () => guild } } };
    const manager = new (WorkersManager as any)(client) as WorkersManager;
    managers.push(manager);
    (manager as any).isEnabled = false;

    await manager.moveMembers(['member-1'], 'new-channel', 1);

    expect(guild.members.fetch).toHaveBeenCalledWith('member-1');
    expect(setChannel).toHaveBeenCalledWith('new-channel');
  });

  it('sets voice channel status through the REST API', async () => {
    const client: any = {
      guilds: { cache: { first: () => ({}) } },
      rest: { put: jest.fn().mockResolvedValue(undefined) }
    };
    const manager = new (WorkersManager as any)(client) as WorkersManager;
    managers.push(manager);
    (manager as any).isEnabled = false;

    await manager.setChannelStatus('channel-1', '3/8');

    expect(client.rest.put).toHaveBeenCalledWith(
      '/channels/channel-1/voice-status',
      expect.objectContaining({ body: { status: '3/8' } })
    );
  });

  it('drops a voice status update for a channel that was already deleted', async () => {
    const client: any = {
      guilds: { cache: { first: () => ({}) } },
      rest: {
        put: jest.fn().mockRejectedValue(Object.assign(new Error('Unknown Channel'), { code: 10003, status: 404 }))
      }
    };
    const manager = new (WorkersManager as any)(client) as WorkersManager;
    managers.push(manager);
    (manager as any).isEnabled = false;

    await expect(manager.setChannelStatus('channel-1', '3/8')).resolves.toBeUndefined();
    expect(client.rest.put).toHaveBeenCalledTimes(1);
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

