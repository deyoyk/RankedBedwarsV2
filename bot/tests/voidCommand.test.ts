jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock('../src/Matchmaking/sharedGameManager', () => ({
  getSharedGameManager: jest.fn()
}));
jest.mock('../src/services/AuditService', () => ({
  auditInteractionContext: jest.fn().mockReturnValue({}),
  recordAudit: jest.fn().mockResolvedValue(undefined)
}));

import { voidGame } from '../src/commands/scoring/void';
import { getSharedGameManager } from '../src/Matchmaking/sharedGameManager';
import Game from '../src/models/Game';

const GameModel = Game as unknown as { findOne: jest.Mock };
const getGameManager = getSharedGameManager as jest.Mock;

function gameQuery(game: unknown) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(game) }) };
}

function interaction() {
  return {
    user: { id: 'staff-1' },
    client: {},
    options: {
      getInteger: () => 212,
      getString: () => null
    },
    reply: jest.fn().mockResolvedValue({})
  } as any;
}

describe('/void', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forces the void when the game is already scored', async () => {
    GameModel.findOne.mockReturnValue(gameQuery({ state: 'scored' }));
    const manager = { voidGame: jest.fn().mockResolvedValue({}) };
    getGameManager.mockReturnValue(manager);
    const target = interaction();

    await voidGame(target, {} as any);

    expect(manager.voidGame).toHaveBeenCalledWith(212, expect.stringContaining('voided by'), false, true);
    expect(JSON.stringify(target.reply.mock.calls)).toContain('voided');
  });

  it('forces the void from any unsettled state', async () => {
    for (const state of ['pending', 'active']) {
      GameModel.findOne.mockReturnValue(gameQuery({ state }));
      const manager = { voidGame: jest.fn().mockResolvedValue({}) };
      getGameManager.mockReturnValue(manager);

      await voidGame(interaction(), {} as any);

      expect(manager.voidGame).toHaveBeenCalledWith(212, expect.any(String), false, true);
    }
  });

  it('refuses a game that is already voided', async () => {
    GameModel.findOne.mockReturnValue(gameQuery({ state: 'voided' }));
    const manager = { voidGame: jest.fn() };
    getGameManager.mockReturnValue(manager);

    await voidGame(interaction(), {} as any);

    expect(manager.voidGame).not.toHaveBeenCalled();
  });
});
