jest.mock('../src/services/PartyService', () => ({
  __esModule: true,
  PartyService: {
    INVITE_TIMEOUT: 300000,
    createParty: jest.fn(),
    inviteToParty: jest.fn(),
    leaveParty: jest.fn(),
    getPartyInfo: jest.fn(),
    disbandParty: jest.fn(),
    kickFromParty: jest.fn(),
    promoteToLeader: jest.fn(),
    updatePartySettings: jest.fn(),
    listPublicParties: jest.fn(),
    joinParty: jest.fn(),
  },
}));
jest.mock('../src/services/PrivateGameService', () => ({
  __esModule: true,
  PrivateGameService: {
    startPrivateGame: jest.fn(),
    cancelPrivateGame: jest.fn(),
  },
}));

import { party } from '../src/commands/queue/party';
import { PrivateGameService } from '../src/services/PrivateGameService';

const startPrivateGame = PrivateGameService.startPrivateGame as jest.Mock;
const cancelPrivateGame = PrivateGameService.cancelPrivateGame as jest.Mock;

const UID = '123456789012345678';

function interaction() {
  const guild = { id: 'guild-1' };
  return {
    guild,
    author: { id: UID },
    channelId: 'channel-1',
    client: { users: { cache: { get: jest.fn() } } },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function ws() {
  return { getGameManager: jest.fn() } as any;
}

function replyText(target: any): string {
  return JSON.stringify(target.reply.mock.calls);
}

describe('party private game command', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts a private game for the party with an optional map', async () => {
    startPrivateGame.mockResolvedValue({
      success: true,
      gameId: 7,
      map: 'Quad',
      team1: ['a', 'b'],
      team2: ['c', 'd'],
    });
    const target = interaction();
    const manager = ws();

    await party(target, ['private', 'Quad'], manager);

    expect(startPrivateGame).toHaveBeenCalledWith(UID, target.guild, manager, { map: 'Quad' });
    const text = replyText(target);
    expect(text).toContain('Private game #7');
    expect(text).toContain('<@a>');
    expect(text).toContain('<@d>');
  });

  it('surfaces private game creation failures', async () => {
    startPrivateGame.mockResolvedValue({ success: false, message: 'Party size 3 exceeds the private game limit of 2' });
    const target = interaction();

    await party(target, ['private'], ws());

    expect(replyText(target)).toContain('Party size 3 exceeds the private game limit of 2');
  });

  it('requires the game service to be available', async () => {
    const target = interaction();

    await party(target, ['private'], undefined);

    expect(startPrivateGame).not.toHaveBeenCalled();
    expect(replyText(target)).toContain('game service is not ready');
  });

  it('cancels the active private game', async () => {
    cancelPrivateGame.mockResolvedValue({ success: true, gameId: 7 });
    const target = interaction();
    const manager = ws();

    await party(target, ['cancel'], manager);

    expect(cancelPrivateGame).toHaveBeenCalledWith(UID, manager);
    expect(replyText(target)).toContain('Private game #7 has been cancelled');
  });

  it('surfaces cancellation failures', async () => {
    cancelPrivateGame.mockResolvedValue({ success: false, message: 'Your party does not have an active private game' });
    const target = interaction();

    await party(target, ['cancel'], ws());

    expect(replyText(target)).toContain('does not have an active private game');
  });
});
