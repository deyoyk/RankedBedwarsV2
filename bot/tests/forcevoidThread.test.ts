import { ChannelType } from 'discord.js';
import { forcevoid } from '../src/commands/scoring/forcevoid';
import { getSharedGameManager } from '../src/Matchmaking/sharedGameManager';
import Game from '../src/models/Game';

jest.mock('../src/Matchmaking/sharedGameManager', () => ({
  getSharedGameManager: jest.fn(),
}));

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

const GameModel = Game as unknown as { findOne: jest.Mock };
const getGameManager = getSharedGameManager as jest.Mock;

function gameQuery(game: unknown) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(game) }) };
}

function interaction(channel: unknown) {
  return {
    channel,
    user: { id: 'staff-1' },
    client: {},
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function replyText(target: any): string {
  return JSON.stringify(target.reply.mock.calls);
}

describe('forcevoid in game threads', () => {
  beforeEach(() => jest.clearAllMocks());

  it('finds and voids the game when used inside a private game thread', async () => {
    GameModel.findOne.mockReturnValue(gameQuery({ state: 'pending', gameId: 42 }));
    const voidGame = jest.fn().mockResolvedValue(undefined);
    getGameManager.mockReturnValue({ voidGame });
    const target = interaction({
      id: 'thread-42',
      type: ChannelType.PrivateThread,
      isTextBased: () => true,
    });

    await forcevoid(target, {} as any);

    expect(GameModel.findOne).toHaveBeenCalledWith({ 'channels.text': 'thread-42' });
    expect(voidGame).toHaveBeenCalledWith(42, 'force voided by <@staff-1>');
    expect(replyText(target)).toContain('force voided');
    expect(replyText(target)).toContain('Game threads will be archived in 30 seconds');
  });

  it('rejects channels that cannot contain game text', async () => {
    const target = interaction({
      id: 'voice-1',
      type: ChannelType.GuildVoice,
      isTextBased: () => false,
    });

    await forcevoid(target, {} as any);

    expect(GameModel.findOne).not.toHaveBeenCalled();
    expect(replyText(target)).toContain('only be used in a game thread');
  });
});
