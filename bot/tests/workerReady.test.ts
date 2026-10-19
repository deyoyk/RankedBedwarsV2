import { WorkersManager } from '../src/managers/WorkersManager';

const mainClientMock: any = {
  guilds: { cache: { first: () => undefined } },
  channels: { cache: { get: () => undefined } }
};

function makeManager(): WorkersManager {
  return new (WorkersManager as any)(mainClientMock);
}

describe('WorkersManager waitForWorkerReady', () => {
  it('resolves true immediately when the worker is ready', async () => {
    const manager = makeManager();
    await expect(manager.waitForWorkerReady({ isReady: true } as any)).resolves.toBe(true);
  });
  it('resolves true when the worker becomes ready', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    const worker: any = { isReady: false };
    const promise = manager.waitForWorkerReady(worker, 30000);
    setTimeout(() => { worker.isReady = true; }, 500);
    jest.advanceTimersByTime(1000);
    await expect(promise).resolves.toBe(true);
    jest.useRealTimers();
  });
  it('resolves false after the timeout when the worker never becomes ready', async () => {
    jest.useFakeTimers();
    const manager = makeManager();
    const promise = manager.waitForWorkerReady({ isReady: false } as any, 5000);
    jest.advanceTimersByTime(6000);
    await expect(promise).resolves.toBe(false);
    jest.useRealTimers();
  });
});
