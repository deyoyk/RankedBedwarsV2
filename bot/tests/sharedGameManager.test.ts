import { getSharedGameManager } from '../src/Matchmaking/sharedGameManager';
import { GameManager } from '../src/Matchmaking/GameManager';

jest.mock('../src/Matchmaking/GameManager', () => ({
  __esModule: true,
  GameManager: jest.fn().mockImplementation(() => ({
    scoreGame: jest.fn(),
    voidGame: jest.fn(),
    getNextGameId: jest.fn(),
  })),
}));

const client = {} as any;

describe('shared GameManager resolution', () => {
  beforeEach(() => {
    delete (global as any)._gameManager;
    jest.clearAllMocks();
  });

  it('reuses the manager already registered on the websocket manager', () => {
    const existing = {
      scoreGame: jest.fn(),
      voidGame: jest.fn(),
      getNextGameId: jest.fn(),
    };
    const ws = {
      getGameManager: jest.fn().mockReturnValue(existing),
      setGameManager: jest.fn(),
    };

    expect(getSharedGameManager(client, ws as any)).toBe(existing);
    expect(GameManager).not.toHaveBeenCalled();
    expect(ws.setGameManager).not.toHaveBeenCalled();
  });

  it('reuses the global manager before constructing another one', () => {
    const existing = {
      scoreGame: jest.fn(),
      voidGame: jest.fn(),
      getNextGameId: jest.fn(),
    };
    (global as any)._gameManager = existing;
    const ws = { getGameManager: jest.fn().mockReturnValue(null), setGameManager: jest.fn() };

    expect(getSharedGameManager(client, ws as any)).toBe(existing);
    expect(GameManager).not.toHaveBeenCalled();
  });

  it('creates and registers exactly one manager when none exists', () => {
    const ws = { getGameManager: jest.fn().mockReturnValue(null), setGameManager: jest.fn() };

    const created = getSharedGameManager(client, ws as any);

    expect(GameManager).toHaveBeenCalledTimes(1);
    expect(ws.setGameManager).toHaveBeenCalledWith(created);
    expect((global as any)._gameManager).toBe(created);
    expect(getSharedGameManager(client, ws as any)).toBe(created);
    expect(GameManager).toHaveBeenCalledTimes(1);
  });
});
