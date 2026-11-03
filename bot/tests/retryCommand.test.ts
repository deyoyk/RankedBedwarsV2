jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import { retry } from '../src/commands/queue/retry';

const GameModel = require('../src/models/Game').default;

function query(value: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function interaction() {
  return {
    channelId: 'channel-1',
    author: { id: 'user-1' },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function replyText(target: any): string {
  return JSON.stringify(target.reply.mock.calls);
}

describe('retry command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses the game manager retry path and reports the attempt count', async () => {
    GameModel.findOne.mockReturnValue(query({ gameId: 42, state: 'pending' }));
    const retryWarp = jest.fn().mockResolvedValue({ attempts: 1, maxAttempts: 3 });
    const target = interaction();

    await retry(target, undefined, { getGameManager: () => ({ retryWarp }) } as any);

    expect(retryWarp).toHaveBeenCalledWith(42);
    expect(replyText(target)).toContain('attempt 1/3');
  });

  it('surfaces per-game cooldown errors from the game manager', async () => {
    GameModel.findOne.mockReturnValue(query({ gameId: 42, state: 'pending' }));
    const retryWarp = jest.fn().mockRejectedValue(new Error('Please wait 12s before retrying game 42.'));
    const target = interaction();

    await retry(target, undefined, { getGameManager: () => ({ retryWarp }) } as any);

    expect(replyText(target)).toContain('Please wait 12s');
  });

  it('refuses games that are no longer pending', async () => {
    GameModel.findOne.mockReturnValue(query({ gameId: 42, state: 'scored' }));
    const retryWarp = jest.fn();
    const target = interaction();

    await retry(target, undefined, { getGameManager: () => ({ retryWarp }) } as any);

    expect(retryWarp).not.toHaveBeenCalled();
    expect(replyText(target)).toContain('can no longer be retried');
  });

  it('refuses to send a raw warp when no game manager exists', async () => {
    GameModel.findOne.mockReturnValue(query({ gameId: 42, state: 'pending' }));
    const target = interaction();

    await retry(target, undefined, { getGameManager: () => null } as any);

    expect(replyText(target)).toContain('Game manager is not available');
  });
});
