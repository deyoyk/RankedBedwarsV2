const mockClients: any[] = [];
const mockLoginResults: string[] = [];

jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js');
  return {
    ...actual,
    Client: jest.fn().mockImplementation(() => {
      const handlers: Record<string, () => void> = {};
      const client: any = {
        user: { tag: 'worker#0001' },
        rest: { on: jest.fn() },
        on: jest.fn(),
        once: (event: string, handler: () => void) => {
          handlers[event] = handler;
        },
        login: jest.fn(async () => {
          if (mockLoginResults.shift() === 'fail') {
            throw new Error('Unexpected server response: 503');
          }
          handlers.clientReady?.();
        }),
        destroy: jest.fn(),
      };
      mockClients.push(client);
      return client;
    }),
  };
});

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    guildId: 'guild-1',
    workers: { enabled: true, tokens: ['token-1'] },
  },
}));

import { WorkersManager } from '../src/managers/WorkersManager';

function makeManager(): WorkersManager {
  return new (WorkersManager as any)({ guilds: { cache: { first: () => undefined } } });
}

describe('WorkersManager worker login retries', () => {
  let manager: WorkersManager;

  beforeEach(() => {
    mockClients.length = 0;
    mockLoginResults.length = 0;
    manager = makeManager();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(manager as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    manager.shutdown();
    jest.restoreAllMocks();
  });

  it('retries a transient gateway failure and keeps the worker', async () => {
    mockLoginResults.push('fail', 'fail', 'ok');

    await manager.initialize();

    expect(mockClients).toHaveLength(3);
    expect(mockClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(mockClients[1].destroy).toHaveBeenCalledTimes(1);
    expect(mockClients[2].destroy).not.toHaveBeenCalled();
    expect((manager as any).workers).toHaveLength(1);
    expect((manager as any).isEnabled).toBe(true);
    expect((manager as any).sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up quietly after the last attempt and falls back to the main client', async () => {
    mockLoginResults.push('fail', 'fail', 'fail', 'fail');

    await manager.initialize();

    expect(mockClients).toHaveLength(4);
    expect(mockClients.every((client) => client.destroy.mock.calls.length === 1)).toBe(true);
    expect((manager as any).workers).toHaveLength(0);
    expect((manager as any).isEnabled).toBe(false);
    expect((manager as any).sleep).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not log in after 4 attempt(s)'),
      expect.any(Error),
    );
  });
});
