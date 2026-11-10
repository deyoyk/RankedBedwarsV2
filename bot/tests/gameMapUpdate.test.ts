import { GameManager } from '../src/Matchmaking/GameManager';
import Game from '../src/models/Game';
import User from '../src/models/User';

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { updateOne: jest.fn() },
}));

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { updateMany: jest.fn(), find: jest.fn() },
}));

const GameModel = Game as unknown as { updateOne: jest.Mock };
const UserModel = User as unknown as { updateMany: jest.Mock };

function makeManager(): GameManager {
  return new GameManager({} as any, { setGlobalHandler: jest.fn() } as any);
}

describe('GameManager.updateGameMap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    GameModel.updateOne.mockResolvedValue({ matchedCount: 1 });
    UserModel.updateMany.mockResolvedValue({});
  });

  it('updates the game, player recent games and the active game resource', async () => {
    const manager = makeManager();
    const resources = { game: { map: 'Old' } } as any;
    (manager as any).activeGames.set(11, resources);

    await manager.updateGameMap(11, '  New Map  ');

    expect(GameModel.updateOne).toHaveBeenCalledWith({ gameId: 11 }, { $set: { map: 'New Map' } });
    expect(UserModel.updateMany).toHaveBeenCalledWith(
      { 'recentGames.gameId': 11 },
      { $set: { 'recentGames.$.map': 'New Map' } },
    );
    expect(resources.game.map).toBe('New Map');
  });

  it('rejects a missing game id instead of silently keeping the old map', async () => {
    const manager = makeManager();
    GameModel.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(manager.updateGameMap(99, 'New Map')).rejects.toThrow('Game 99 not found');
    expect(UserModel.updateMany).not.toHaveBeenCalled();
  });

  it('rejects blank map names before querying the database', async () => {
    const manager = makeManager();

    await expect(manager.updateGameMap(1, '   ')).rejects.toThrow('Map name is required');
    expect(GameModel.updateOne).not.toHaveBeenCalled();
  });
});
