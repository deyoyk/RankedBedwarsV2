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

  it('does not create a game when the session ends during final revalidation', async () => {
    const manager = makeManager(jest.fn());
    const session: any = {
      gameId: 9,
      captains: ['a', 'b'],
      remainingPlayers: [],
      currentPicker: 'a',
      pickCount: 2,
      team1: ['a', 'c'],
      team2: ['b', 'd'],
      timeout: setTimeout(() => {}, 100000),
      active: true,
      pickingResources: resources(),
    };
    const createGame = jest.fn().mockResolvedValue({ gameId: 9, gameChannel: { id: 'new-text' } });
    manager.gameManager = { createGame } as any;
    manager.activeSessions.set(9, session);
    jest.spyOn(manager, 'revalidateFinalTeams').mockImplementation(async () => {
      session.active = false;
      return { team1: ['a', 'c'], team2: ['b', 'd'] };
    });

    const result = await manager.completePicking(
      session,
      { team1: ['a', 'c'], team2: ['b', 'd'] },
      resources(),
      { channelId: 'q', maxPlayers: 4, minElo: 0, maxElo: 9999, bypassRoles: [] },
      'Aquarius',
    );

    expect(result.success).toBe(false);
    expect(createGame).not.toHaveBeenCalled();
    clearTimeout(session.timeout);
  });

  it('does not finalize a cancelled or timed-out picking session', async () => {
    const manager = makeManager(jest.fn());
    const session = {
      gameId: 8,
      captains: ['a', 'b'],
      remainingPlayers: ['c', 'd'],
      currentPicker: 'a',
      pickCount: 0,
      team1: ['a'],
      team2: ['b'],
      timeout: setTimeout(() => {}, 100000),
      active: false,
      pickingResources: resources(),
    };

    const result = await manager.executePicking(
      { id: 'picking-text' } as any,
      session,
      { channelId: 'q', maxPlayers: 4, minElo: 0, maxElo: 9999, bypassRoles: [] },
      'Aquarius',
    );

    expect(result).toBeNull();
    clearTimeout(session.timeout);
  });
});
