import { StatusRotationTask } from '../src/tasks/StatusRotationTask';
import { PartyCleanupTask } from '../src/tasks/PartyCleanupTask';
import { ChannelsCleanupTask } from '../src/tasks/ChannelsCleanupTask';

jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { find: jest.fn(), deleteOne: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({}) }
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { updateMany: jest.fn().mockResolvedValue({}) }
}));

const PartyModel = require('../src/models/Party').default;

function presenceClient() {
  return {
    user: {
      setActivity: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined)
    }
  } as any;
}

describe('periodic task hygiene', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('status rotation starts once and stops cleanly', () => {
    const task = new StatusRotationTask(presenceClient());
    task.start();
    task.start();
    expect(jest.getTimerCount()).toBe(1);
    task.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('status rotation tolerates Discord rejections', async () => {
    const failing: any = {
      user: {
        setActivity: jest.fn().mockRejectedValue(new Error('rate limited')),
        setStatus: jest.fn().mockResolvedValue(undefined)
      }
    };
    const errors: unknown[] = [];
    const listener = (reason: unknown) => errors.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const task = new StatusRotationTask(failing);
      const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
      task.start();
      await Promise.resolve();
      await Promise.resolve();
      expect(logged).toHaveBeenCalled();
      expect(errors).toHaveLength(0);
      logged.mockRestore();
      task.stop();
    } finally {
      process.removeListener('unhandledRejection', listener);
    }
  });

  it('party cleanup starts once and never overlaps itself', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    PartyModel.find.mockImplementation(() => ({ limit: () => ({ lean: () => gate.then(() => []) }) }));
    const task = new PartyCleanupTask({} as any);
    task.start();
    task.start();
    expect(jest.getTimerCount()).toBe(1);

    const first = (task as any).cleanupInactiveParties();
    const second = (task as any).cleanupInactiveParties();
    release();
    await Promise.all([first, second]);
    expect(PartyModel.find).toHaveBeenCalledTimes(1);
    task.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('channel cleanup starts once and stops cleanly', () => {
    const task = new ChannelsCleanupTask({} as any);
    task.start();
    task.start();
    expect(jest.getTimerCount()).toBe(1);
    task.stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
