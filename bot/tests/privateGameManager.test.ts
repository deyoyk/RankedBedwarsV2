const mockDeleteChannel = jest.fn().mockResolvedValue(undefined);
const mockCreateChannel = jest.fn();

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
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
  findOne: jest.Mock;
  updateOne: jest.Mock;
  deleteOne: jest.Mock;
};

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

describe('GameManager private game lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateChannel.mockReset();
    mockDeleteChannel.mockResolvedValue(undefined);
    GameModel.findOne.mockReturnValue(chain(null));
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
});
