import { PickingQueueManager } from '../src/Matchmaking/PickingQueueManager';
import config from '../src/config/config';

const mockCloseGameTextChannel = jest.fn().mockResolvedValue('archived');

jest.mock('../src/utils/gameThreads', () => ({
  createGameThread: jest.fn(),
  closeGameTextChannel: (...args: unknown[]) => mockCloseGameTextChannel(...args),
}));

function makeManager(deleteChannel: jest.Mock) {
  const manager = new PickingQueueManager(
    { guilds: { cache: { first: () => ({}) } } } as any,
    {} as any,
    {} as any
  );
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
  beforeEach(() => {
    mockCloseGameTextChannel.mockClear();
    mockCloseGameTextChannel.mockResolvedValue('archived');
  });

  it('archives the picking thread and deletes the voice channel', async () => {
    const deleteChannel = jest.fn().mockResolvedValue(undefined);
    await makeManager(deleteChannel).cleanupPickingChannels(resources());
    expect(deleteChannel).toHaveBeenCalledTimes(1);
    expect(deleteChannel).toHaveBeenCalledWith('picking-vc-1', 2);
    expect(mockCloseGameTextChannel).toHaveBeenCalledWith(
      expect.anything(),
      'picking-text-1',
      'Picking session ended'
    );
  });
  it('skips channels that were never created', async () => {
    const deleteChannel = jest.fn().mockResolvedValue(undefined);
    await makeManager(deleteChannel).cleanupPickingChannels({});
    expect(deleteChannel).not.toHaveBeenCalled();
    expect(mockCloseGameTextChannel).not.toHaveBeenCalled();
  });
  it('tolerates deletion failures without throwing', async () => {
    const deleteChannel = jest.fn().mockRejectedValue(new Error('Missing Access'));
    await expect(makeManager(deleteChannel).cleanupPickingChannels(resources())).resolves.toBeUndefined();
    expect(deleteChannel).toHaveBeenCalledTimes(1);
    expect(mockCloseGameTextChannel).toHaveBeenCalledTimes(1);
  });
  it('timeout clears the session and closes stashed channels', async () => {
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
    expect(deleteChannel).toHaveBeenCalledTimes(1);
    expect(mockCloseGameTextChannel).toHaveBeenCalledTimes(1);
  });

  it('runs map voting on the new game thread before warping', async () => {
    const deleteChannel = jest.fn().mockResolvedValue(undefined);
    const manager = makeManager(deleteChannel);
    const session: any = {
      gameId: 12,
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
    const gameManager = {
      createGame: jest.fn().mockResolvedValue({ gameId: 12, gameChannel: { id: 'game-thread-12' } }),
      updateGameMap: jest.fn().mockResolvedValue(undefined),
      initiateGameWarp: jest.fn().mockResolvedValue(undefined),
      voidGame: jest.fn().mockResolvedValue(undefined),
    };
    manager.gameManager = gameManager;
    manager.activeSessions.set(12, session);
    manager.mapVoteService = { run: jest.fn().mockResolvedValue('VotedMap') };
    manager.mapService = { claimMap: jest.fn() };
    manager.announcePickedGame = jest.fn().mockResolvedValue(undefined);
    const revalidateFinalTeams = jest.spyOn(manager, 'revalidateFinalTeams')
      .mockResolvedValue({ team1: ['a', 'c'], team2: ['b', 'd'] });
    config.mapSelection.enabled = true;

    try {
      const result = await manager.completePicking(
        session,
        { team1: ['a', 'c'], team2: ['b', 'd'] },
        resources(),
        { channelId: 'q', maxPlayers: 4, minElo: 0, maxElo: 9999, bypassRoles: [] },
        'InitialMap',
        ['InitialMap', 'VotedMap', 'ThirdMap'],
      );

      expect(result.success).toBe(true);
      expect(gameManager.createGame).toHaveBeenCalledWith(
        12,
        expect.anything(),
        ['a', 'c'],
        ['b', 'd'],
        'InitialMap',
      );
      expect(revalidateFinalTeams.mock.invocationCallOrder[0])
        .toBeLessThan(manager.mapVoteService.run.mock.invocationCallOrder[0]);
      expect(manager.mapVoteService.run).toHaveBeenCalledWith(
        12,
        'game-thread-12',
        ['a', 'c', 'b', 'd'],
        ['InitialMap', 'VotedMap', 'ThirdMap'],
      );
      expect(gameManager.updateGameMap).toHaveBeenCalledWith(12, 'VotedMap');
      expect(gameManager.initiateGameWarp).toHaveBeenCalledWith(12);
      expect(manager.announcePickedGame).toHaveBeenCalledWith(
        session,
        { team1: ['a', 'c'], team2: ['b', 'd'] },
        'game-thread-12',
        expect.anything(),
        'VotedMap',
      );
      expect(manager.mapService.claimMap).toHaveBeenCalledWith('VotedMap');
    } finally {
      config.mapSelection.enabled = false;
      clearTimeout(session.timeout);
    }
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
