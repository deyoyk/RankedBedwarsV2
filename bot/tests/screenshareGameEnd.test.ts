jest.mock('../src/models/ScreenshareSession', () => ({
  __esModule: true,
  default: { find: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }
}));
jest.mock('../src/services/AuditService', () => ({ recordAudit: jest.fn().mockResolvedValue(undefined) }));

import { ScreenshareService } from '../src/services/ScreenshareService';

const SessionModel = require('../src/models/ScreenshareSession').default;

const NOW = 1_700_000_000_000;

function guildWith(channels: Record<string, { send: jest.Mock }>) {
  const find = (id: string) => {
    const channel = channels[id];
    return channel ? { ...channel, isTextBased: () => true } : undefined;
  };
  return { id: 'g1', channels: { cache: { get: find }, fetch: jest.fn(async (id: string) => find(id) ?? null) } } as any;
}

function waiting(sessions: any[]) {
  SessionModel.find.mockReturnValue({ collation: jest.fn().mockResolvedValue(sessions) });
}

describe('screenshare tickets made during a game', () => {
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    global._wsManager = { registerScreenshareThread: jest.fn() } as any;
  });
  afterEach(() => {
    nowSpy.mockRestore();
    delete (global as any)._wsManager;
  });

  it('start their 10 minutes when the game ends and say so in the thread', async () => {
    const thread = { send: jest.fn().mockResolvedValue(undefined) };
    waiting([{ sessionId: 'S1', targetIgn: 'Parady' }]);
    SessionModel.findOneAndUpdate.mockResolvedValue({ sessionId: 'S1', targetIgn: 'Parady', threadId: 'th1' });

    const started = await ScreenshareService.startAfterGame(guildWith({ th1: thread }), ['parady']);

    expect(started).toBe(1);
    const [query] = SessionModel.find.mock.calls[0];
    expect(query).toMatchObject({ waitingForGame: true, targetIgn: { $in: ['parady'] } });
    const [filter, update] = SessionModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ sessionId: 'S1', waitingForGame: true, takenBy: { $exists: false } });
    expect(update).toEqual({ $set: { expireTime: new Date(NOW + 10 * 60 * 1000) }, $unset: { waitingForGame: '' } });
    expect(thread.send).toHaveBeenCalledWith(expect.stringContaining('The game is over'));
    expect(global._wsManager!.registerScreenshareThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'th1', expiresAt: NOW + 10 * 60 * 1000 })
    );
  });

  it('leave a taken ticket on its own timer', async () => {
    waiting([{ sessionId: 'S1', targetIgn: 'Parady', takenBy: 'mod1' }]);

    const started = await ScreenshareService.startAfterGame(guildWith({}), ['Parady']);

    expect(started).toBe(0);
    expect(SessionModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(SessionModel.updateOne).toHaveBeenCalledWith({ sessionId: 'S1' }, { $unset: { waitingForGame: '' } });
  });

  it('do nothing without any players', async () => {
    expect(await ScreenshareService.startAfterGame(guildWith({}), [])).toBe(0);
    expect(SessionModel.find).not.toHaveBeenCalled();
  });

  it('say the timer waits for the game in the request and freeze messages', () => {
    const request = ScreenshareService.createSessionEmbed({ targetId: 't1', requesterId: 'r1', reason: 'x', waitingForGame: true } as any)
      .toJSON().description!;
    expect(request).toContain('10 minutes after the game ends');
    const freeze = ScreenshareService.createFreezeEmbed('t1', true).toJSON().description!;
    expect(freeze).toContain('closes 10 minutes after it ends');
    expect(ScreenshareService.createFreezeEmbed('t1').toJSON().description!).toContain('closes in 10 minutes');
  });
});
