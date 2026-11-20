jest.mock('../src/models/User', () => ({ __esModule: true, default: { updateMany: jest.fn() } }));

import { LAST_QUEUE_MS, recentQueueId } from '../src/utils/lastQueue';

describe('the last queue for /q', () => {
  const now = Date.UTC(2026, 10, 20, 12);

  it('is remembered for 24 hours', () => {
    expect(recentQueueId({ lastQueueChannelId: 'q1', lastQueueAt: new Date(now - 60_000) }, now)).toBe('q1');
    expect(recentQueueId({ lastQueueChannelId: 'q1', lastQueueAt: new Date(now - LAST_QUEUE_MS) }, now)).toBe('q1');
    expect(recentQueueId({ lastQueueChannelId: 'q1', lastQueueAt: new Date(now - LAST_QUEUE_MS - 1) }, now)).toBeNull();
  });

  it('is nothing without a saved queue', () => {
    expect(recentQueueId({}, now)).toBeNull();
    expect(recentQueueId({ lastQueueChannelId: 'q1' }, now)).toBeNull();
    expect(recentQueueId({ lastQueueChannelId: 'q1', lastQueueAt: 'not a date' }, now)).toBeNull();
  });
});
