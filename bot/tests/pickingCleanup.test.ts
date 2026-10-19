import { PickingQueueManager } from '../src/Matchmaking/PickingQueueManager';

function makeManager(deleteChannel: jest.Mock) {
  const manager = new PickingQueueManager({} as any, {} as any, {} as any);
  (manager as any).workersManager = { deleteChannel };
  return manager as any;
}

function resources() {
  return {
    pickingChannel: { id: 'picking-vc-1' },
    gameChannel: { id: 'picking-text-1' }
  };
}

describe('PickingQueueManager channel cleanup', () => {
  it('deletes the picking voice and text channels', async () => {
    const deleteChannel = jest.fn().mockResolvedValue(undefined);
    await makeManager(deleteChannel).cleanupPickingChannels(resources());
    expect(deleteChannel).toHaveBeenCalledTimes(2);
    expect(deleteChannel).toHaveBeenCalledWith('picking-vc-1', 2);
    expect(deleteChannel).toHaveBeenCalledWith('picking-text-1', 2);
  });
  it('skips channels that were never created', async () => {
    const deleteChannel = jest.fn().mockResolvedValue(undefined);
    await makeManager(deleteChannel).cleanupPickingChannels({});
    expect(deleteChannel).not.toHaveBeenCalled();
  });
  it('tolerates deletion failures without throwing', async () => {
    const deleteChannel = jest.fn().mockRejectedValue(new Error('Missing Access'));
    await expect(makeManager(deleteChannel).cleanupPickingChannels(resources())).resolves.toBeUndefined();
    expect(deleteChannel).toHaveBeenCalledTimes(2);
  });
  it('timeout clears the session and deletes stashed channels', async () => {
    const deleteChannel = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager(deleteChannel);
    manager.activeSessions.set(7, {
      gameId: 7,
      captains: [],
      remainingPlayers: [],
      currentPicker: '',
      pickCount: 0,
      team1: [],
      team2: [],
      timeout: setTimeout(() => {}, 100000),
      active: true,
      pickingResources: resources()
    });
    manager.handlePickingTimeout(7);
    await new Promise(resolve => setImmediate(resolve));
    expect(manager.activeSessions.has(7)).toBe(false);
    expect(deleteChannel).toHaveBeenCalledTimes(2);
  });
});
