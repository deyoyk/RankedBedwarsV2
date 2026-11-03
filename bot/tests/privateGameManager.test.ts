const mockDeleteChannel = jest.fn().mockResolvedValue(undefined);
const mockCreateChannel = jest.fn();

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    find: jest.fn(),
    findOne: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: {} }));
jest.mock('../src/models/Counter', () => ({
  __esModule: true,
  getNextSequence: jest.fn(),
  Counter: { updateOne: jest.fn() },
}));
jest.mock('../src/managers/WorkersManager', () => ({
  __esModule: true,
  WorkersManager: {
    getInstance: () => ({
      createChannel: (...args: unknown[]) => mockCreateChannel(...args),
      deleteChannel: (...args: unknown[]) => mockDeleteChannel(...args),
      moveMembers: jest.fn().mockResolvedValue([]),
      sendMessage: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));
jest.mock('../src/utils/scoreImage', () => ({
  __esModule: true,
  generateScoreImageBuffer: jest.fn().mockResolvedValue(null),
}));
jest.mock('../src/utils/fix', () => ({
  __esModule: true,
  fix: jest.fn().mockResolvedValue(undefined),
  safeFix: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/utils/userStats', () => ({
  __esModule: true,
  updateDailyElo: jest.fn(),
  ensureUserStats: jest.fn(),
  resetUserStats: jest.fn(),
  computeWlr: jest.fn(),
}));

import { GameManager } from '../src/Matchmaking/GameManager';
import Game from '../src/models/Game';

const GameModel = Game as unknown as {
  find: jest.Mock;
  findOne: jest.Mock;
  updateOne: jest.Mock;
  deleteOne: jest.Mock;
};
const SettlementModel = require('../src/models/GameSettlement').default as { find: jest.Mock; updateOne: jest.Mock };

const wsMock = { send: jest.fn(), setGlobalHandler: jest.fn() };
const clientMock = {
  guilds: { cache: { first: jest.fn() } },
  channels: { cache: { get: jest.fn() } },
};

function makeManager() {
  return new GameManager(clientMock as any, wsMock as any);
}

function chain(value: any) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
    then: (resolve: (value: any) => void) => resolve(value),
  };
}

function resources(gameId = 1) {
  return {
    gameId,
    gameChannel: { id: 'text-1' },
    team1Voice: { id: 'voice-1' },
    team2Voice: { id: 'voice-2' },
    game: null,
  } as any;
}

function gameDoc(gameId: number, state: string, startTime = new Date()) {
  return {
    gameId,
    state,
    startTime,
    map: 'Quad',
    team1: ['a', 'b'],
    team2: ['c', 'd'],
    isRanked: false,
    channels: {
      text: `text-${gameId}`,
      team1Voice: `voice1-${gameId}`,
      team2Voice: `voice2-${gameId}`,
    },
  };
}

describe('GameManager private game lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateChannel.mockReset();
    mockDeleteChannel.mockResolvedValue(undefined);
    GameModel.findOne.mockReturnValue(chain(null));
    GameModel.find.mockResolvedValue([]);
    SettlementModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    SettlementModel.updateOne.mockResolvedValue({});
    clientMock.guilds.cache.first.mockReturnValue({
      id: 'guild-1',
      roles: { everyone: { id: 'everyone' } },
      channels: { cache: new Map() },
    });
  });

  it('delegates private games with private queue metadata', async () => {
    const manager = makeManager();
    jest.spyOn(manager, 'getNextGameId').mockResolvedValue(55);
    const createSpy = jest.spyOn(manager, 'createGame').mockResolvedValue(resources(55));

    const result = await manager.createPrivateGame({
      partyId: 'PARTY1',
      map: 'Quad',
      team1: ['a', 'b'],
      team2: ['c', 'd'],
    });

    expect(result.gameId).toBe(55);
    expect(createSpy).toHaveBeenCalledWith(
      55,
      expect.objectContaining({
        channelId: 'private:PARTY1',
        maxPlayers: 4,
        isRanked: false,
        isPrivate: true,
        privatePartyId: 'PARTY1',
      }),
      ['a', 'b'],
      ['c', 'd'],
      'Quad',
    );
  });

  it('rejects private games with invalid team sizes', async () => {
    const manager = makeManager();

    await expect(manager.createPrivateGame({
      partyId: 'PARTY1',
      map: 'Quad',
      team1: ['a'],
      team2: ['b', 'c'],
    })).rejects.toThrow('Private game requires an even number of players');
  });

  it('supports a null queue by building a safe queue descriptor', async () => {
    const manager = makeManager();
    const createResources = jest.spyOn(manager as any, 'createGameResources').mockResolvedValue(resources());
    const createDb = jest.spyOn(manager as any, 'createGameInDatabaseAndUpdateUsers').mockResolvedValue(undefined);
    jest.spyOn(manager as any, 'movePlayersToVoiceChannels').mockResolvedValue(undefined);
    jest.spyOn(manager as any, 'getGuild').mockResolvedValue(clientMock.guilds.cache.first());

    await manager.createGame(1, null, ['a', 'b'], ['c', 'd'], 'Quad');

    expect(createResources).toHaveBeenCalled();
    expect(createDb).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channelId: 'private',
        maxPlayers: 4,
        isRanked: false,
        isPrivate: false,
        bypassRoles: [],
      }),
      'Quad',
      ['a', 'b'],
      ['c', 'd'],
    );
    expect((manager as any).creatingPlayers.size).toBe(0);
  });

  it('rejects a second game while the same player is being placed', async () => {
    const manager = makeManager();
    (manager as any).reservePlayersForGame(99, ['a']);

    await expect(manager.createGame(1, null, ['a', 'b'], ['c', 'd'], 'Quad'))
      .rejects.toThrow('already being placed into another game');

    (manager as any).releaseCreatingPlayers(99);
  });

  it('ignores duplicate warp requests while one is already pending', async () => {
    const manager = makeManager();
    const timeout = setTimeout(() => {}, 60000);
    (manager as any).activeGames.set(1, {
      ...resources(1),
      game: {
        gameId: 1,
        map: 'Quad',
        team1: ['a', 'b'],
        team2: ['c', 'd'],
        isRanked: false,
      },
    });
    (manager as any).warpRequests.set('1', {
      gameId: '1',
      timeout,
      attempts: 0,
      team1IGNs: ['a', 'b'],
      team2IGNs: ['c', 'd'],
      map: 'Quad',
      isRanked: false,
      timestamp: Date.now(),
    });

    await manager.initiateGameWarp(1);
    clearTimeout(timeout);

    expect(wsMock.send).not.toHaveBeenCalled();
  });

  it('deletes partially created channels when database creation fails', async () => {
    const manager = makeManager();
    jest.spyOn(manager as any, 'createGameResources').mockResolvedValue(resources());
    jest.spyOn(manager as any, 'createGameInDatabaseAndUpdateUsers').mockRejectedValue(new Error('db down'));
    jest.spyOn(manager as any, 'getGuild').mockResolvedValue(clientMock.guilds.cache.first());

    await expect(manager.createGame(1, null, ['a', 'b'], ['c', 'd'], 'Quad'))
      .rejects.toThrow('db down');

    expect(mockDeleteChannel).toHaveBeenCalledWith('text-1', 0);
    expect(mockDeleteChannel).toHaveBeenCalledWith('voice-1', 0);
    expect(mockDeleteChannel).toHaveBeenCalledWith('voice-2', 0);
  });

  it('deletes already-created channels when a later channel creation fails', async () => {
    const manager = makeManager();
    mockCreateChannel
      .mockResolvedValueOnce({ id: 'text-1' })
      .mockRejectedValueOnce(new Error('missing permissions'));

    await expect((manager as any).createGameResources(
      clientMock.guilds.cache.first(),
      1,
      'Quad',
      ['a', 'b', 'c', 'd'],
      null,
    )).rejects.toThrow('missing permissions');

    expect(mockDeleteChannel).toHaveBeenCalledWith('text-1', 0);
  });

  it('abortGame removes active resources and marks the game voided', async () => {
    const manager = makeManager();
    (manager as any).activeGames.set(7, resources(7));
    GameModel.findOne.mockReturnValue(chain({ team1: ['a', 'b'], team2: ['c', 'd'], state: 'pending' }));
    const UserModel = require('../src/models/User').default;
    UserModel.find.mockReturnValue(chain([{ discordId: 'a' }]));

    await manager.abortGame(7, 'warp failed');

    expect(mockDeleteChannel).toHaveBeenCalledWith('text-1', 2);
    expect(GameModel.updateOne).toHaveBeenCalledWith(
      { gameId: 7, state: { $in: ['pending', 'active'] } },
      expect.objectContaining({ $set: expect.objectContaining({ state: 'voided', reason: 'warp failed' }) }),
    );
    expect(UserModel.updateMany).toHaveBeenCalled();
  });

  it('rehydrates pending and active games and resumes pending warps', async () => {
    const manager = makeManager();
    GameModel.find.mockResolvedValue([
      gameDoc(1, 'pending'),
      gameDoc(2, 'active'),
      gameDoc(3, 'scoring'),
    ]);
    const warp = jest.spyOn(manager, 'initiateGameWarp').mockResolvedValue(undefined);
    const voidGame = jest.spyOn(manager, 'voidGame').mockResolvedValue({} as any);

    const result = await manager.recoverActiveGames();

    expect(manager.getActiveGameCount()).toBe(3);
    expect(warp).toHaveBeenCalledWith(1);
    expect(warp).not.toHaveBeenCalledWith(2);
    expect(voidGame).toHaveBeenCalledWith(3, 'Recovered interrupted settlement after restart', true);
    expect(result).toEqual({ recovered: 3, warped: 1, voided: 1 });
  });

  it('voids stale pending games instead of warping them', async () => {
    const manager = makeManager();
    GameModel.find.mockResolvedValue([
      gameDoc(1, 'pending', new Date(Date.now() - 60 * 60 * 1000)),
    ]);
    const warp = jest.spyOn(manager, 'initiateGameWarp').mockResolvedValue(undefined);
    const voidGame = jest.spyOn(manager, 'voidGame').mockResolvedValue({} as any);

    const result = await manager.recoverActiveGames();

    expect(warp).not.toHaveBeenCalled();
    expect(voidGame).toHaveBeenCalledWith(1, 'Recovered stale pending game after restart');
    expect(result.voided).toBe(1);
  });

  it('resumes pending warps when the plugin reconnects', async () => {
    const manager = makeManager();
    GameModel.find.mockResolvedValue([gameDoc(4, 'pending')]);
    const warp = jest.spyOn(manager, 'initiateGameWarp').mockResolvedValue(undefined);

    await manager.resumePendingWarps();

    expect(warp).toHaveBeenCalledWith(4);
    expect(manager.getActiveGameCount()).toBe(1);
  });

  it('does not warp games with an unfinished settlement journal', async () => {
    const manager = makeManager();
    GameModel.find.mockResolvedValue([gameDoc(1, 'pending')]);
    SettlementModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ gameId: 1 }]),
    });
    const warp = jest.spyOn(manager, 'initiateGameWarp').mockResolvedValue(undefined);

    await manager.recoverActiveGames();

    expect(warp).not.toHaveBeenCalled();
  });

  it('resumes an unfinished score settlement and skips already-settled players', async () => {
    const manager = makeManager();
    const payload = { gameId: 9, winningTeam: 1, mvps: [], bedbreaks: [] };
    SettlementModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ gameId: 9, type: 'score', status: 'started', payload }]),
    });
    GameModel.findOne.mockReturnValue(chain(gameDoc(9, 'scored')));
    const UserModel = require('../src/models/User').default;
    UserModel.find.mockReturnValue(chain([
      { discordId: 'a', recentGames: [{ gameId: 9, state: 'scored' }] },
      { discordId: 'b', recentGames: [{ gameId: 9, state: 'pending' }] },
      { discordId: 'c', recentGames: [{ gameId: 9, state: 'scored' }] },
      { discordId: 'd', recentGames: [{ gameId: 9, state: 'pending' }] },
    ]));
    const scoreGame = jest.spyOn(manager, 'scoreGame').mockResolvedValue({} as any);

    const result = await manager.recoverPendingSettlements();

    expect(GameModel.updateOne).toHaveBeenCalledWith(
      { gameId: 9, state: 'scored' },
      { $set: { state: 'active' } },
    );
    expect(scoreGame).toHaveBeenCalledWith(payload, true);
    expect(result).toEqual({ recovered: 1, failed: 0 });
  });

  it('resumes an unfinished void settlement', async () => {
    const manager = makeManager();
    SettlementModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        gameId: 10,
        type: 'void',
        status: 'started',
        payload: { reason: 'server crash' },
      }]),
    });
    GameModel.findOne.mockReturnValue(chain(gameDoc(10, 'scored')));
    const UserModel = require('../src/models/User').default;
    UserModel.find.mockReturnValue(chain([
      { discordId: 'a', recentGames: [{ gameId: 10, state: 'scored' }] },
      { discordId: 'b', recentGames: [{ gameId: 10, state: 'voided' }] },
      { discordId: 'c', recentGames: [{ gameId: 10, state: 'scored' }] },
      { discordId: 'd', recentGames: [{ gameId: 10, state: 'voided' }] },
    ]));
    const voidGame = jest.spyOn(manager, 'voidGame').mockResolvedValue({} as any);

    const result = await manager.recoverPendingSettlements();

    expect(GameModel.updateOne).toHaveBeenCalledWith(
      { gameId: 10, state: 'scored' },
      { $set: { state: 'active' } },
    );
    expect(voidGame).toHaveBeenCalledWith(10, 'server crash', true);
    expect(result).toEqual({ recovered: 1, failed: 0 });
  });

  it('finalizes an already-applied settlement and cleans its channels', async () => {
    const manager = makeManager();
    SettlementModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        gameId: 9,
        type: 'score',
        status: 'stats_applied',
        payload: { gameId: 9, winningTeam: 1, mvps: [], bedbreaks: [] },
      }]),
    });
    GameModel.findOne.mockReturnValue(chain(gameDoc(9, 'scored')));
    const UserModel = require('../src/models/User').default;
    UserModel.find.mockReturnValue(chain([
      { discordId: 'a', recentGames: [{ gameId: 9, state: 'scored' }] },
      { discordId: 'b', recentGames: [{ gameId: 9, state: 'scored' }] },
      { discordId: 'c', recentGames: [{ gameId: 9, state: 'scored' }] },
      { discordId: 'd', recentGames: [{ gameId: 9, state: 'scored' }] },
    ]));
    const scoreGame = jest.spyOn(manager, 'scoreGame');
    const cleanup = jest.spyOn(manager as any, 'cleanupGame').mockResolvedValue(undefined);
    jest.spyOn(manager as any, 'scheduleGameChannelCleanup').mockResolvedValue(undefined);

    const result = await manager.recoverPendingSettlements();

    expect(scoreGame).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith(9);
    expect(SettlementModel.updateOne).toHaveBeenCalledWith(
      { gameId: 9 },
      { $set: { status: 'completed' }, $unset: { payload: '' } },
    );
    expect(result).toEqual({ recovered: 1, failed: 0 });
  });
});
