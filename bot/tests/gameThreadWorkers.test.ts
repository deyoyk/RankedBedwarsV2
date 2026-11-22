import { createGameThread } from '../src/utils/gameThreads';

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: { channels: { gameThreadsChannel: 'parent-1' }, categories: {} }
}));

describe('createGameThread', () => {
  test('adds every player once through the given adder instead of the main bot', async () => {
    const mainAdd = jest.fn();
    const thread = { id: 'thread-9', members: { add: mainAdd } };
    const parent = { type: 0, threads: { create: jest.fn().mockResolvedValue(thread) } };
    const guild = { channels: { cache: { get: () => parent }, fetch: jest.fn().mockResolvedValue(parent) } };
    const added: string[] = [];
    const result = await createGameThread(guild as any, 7, ['a', 'b', 'a', 'c'], undefined, async (threadId, id) => {
      expect(threadId).toBe('thread-9');
      added.push(id);
    });
    expect(result).toBe(thread);
    expect(added.sort()).toEqual(['a', 'b', 'c']);
    expect(mainAdd).not.toHaveBeenCalled();
  });
});
