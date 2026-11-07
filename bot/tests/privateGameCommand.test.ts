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
    validatePartyAccess: jest.fn(),
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
import { PartyService } from '../src/services/PartyService';
import { PrivateGameService } from '../src/services/PrivateGameService';

const validatePartyAccess = PartyService.validatePartyAccess as jest.Mock;
const startPrivateGame = PrivateGameService.startPrivateGame as jest.Mock;
const cancelPrivateGame = PrivateGameService.cancelPrivateGame as jest.Mock;

const UID = '123456789012345678';

function partyDocument() {
  return {
    partyId: 'PARTY1',
    leader: UID,
    members: [UID, 'b', 'c', 'd'],
    maxMembers: 8,
    isPrivate: false,
  } as any;
}

function fakeCollector() {
  const handlers: Record<string, (...args: any[]) => Promise<void> | void> = {};
  return {
    handlers,
    on: jest.fn((event: string, handler: (...args: any[]) => Promise<void> | void) => {
      handlers[event] = handler;
    }),
    stop: jest.fn(),
  };
}

function interaction(action = 'private', argsString?: string) {
  const collector = fakeCollector();
  const message = {
    createMessageComponentCollector: jest.fn(() => collector),
    edit: jest.fn().mockResolvedValue({}),
  };
  return {
    collector,
    message,
    target: {
      id: `interaction-${action}`,
      guild: { id: 'guild-1' },
      user: { id: UID },
      channelId: 'channel-1',
      client: { users: { cache: { get: jest.fn() } } },
      options: {
        getString: (name: string) => {
          if (name === 'action') return action;
          if (name === 'args') return argsString ?? null;
          if (name === 'party_id') return null;
          return null;
        },
        getUser: () => null,
      },
      reply: jest.fn().mockResolvedValue(message),
    } as any,
  };
}

function ws() {
  return { getGameManager: jest.fn() } as any;
}

function replyText(target: any): string {
  return JSON.stringify(target.reply.mock.calls);
}

function buttonIds(target: any): string[] {
  const row = target.reply.mock.calls[0][0].components[0];
  return row.components.map((button: any) => button.data.custom_id);
}

function click(customId: string, userId = UID) {
  return {
    user: { id: userId },
    customId,
    update: jest.fn().mockResolvedValue({}),
    editReply: jest.fn().mockResolvedValue({}),
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

describe('party private game command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validatePartyAccess.mockResolvedValue({ isValid: true, party: partyDocument() });
  });

  it('shows a confirmation prompt instead of starting immediately', async () => {
    const { target } = interaction('private', 'Quad');

    await party(target, ws());

    expect(startPrivateGame).not.toHaveBeenCalled();
    const text = replyText(target);
    expect(text).toContain('Confirm Private Game');
    expect(text).toContain('Quad');
    expect(text).toContain('Only the party leader can confirm this game.');
  });

  it('starts the private game after the leader confirms', async () => {
    startPrivateGame.mockResolvedValue({
      success: true,
      gameId: 7,
      map: 'Quad',
      team1: ['a', 'b'],
      team2: ['c', 'd'],
    });
    const manager = ws();
    const { target, collector } = interaction('private', 'Quad');

    await party(target, manager);
    const confirmId = buttonIds(target).find(id => id.startsWith('private_confirm_'))!;
    const button = click(confirmId);
    await collector.handlers.collect(button);

    expect(startPrivateGame).toHaveBeenCalledWith(UID, target.guild, manager, { map: 'Quad' });
    expect(button.update).toHaveBeenCalled();
    const text = JSON.stringify(button.editReply.mock.calls);
    expect(text).toContain('Private game #7');
    expect(text).toContain('<@a>');
    expect(text).toContain('<@d>');
    expect(collector.stop).toHaveBeenCalledWith('started');
  });

  it('does not start when the leader cancels the confirmation', async () => {
    const { target, collector } = interaction('private');

    await party(target, ws());
    const cancelId = buttonIds(target).find(id => id.startsWith('private_cancel_'))!;
    const button = click(cancelId);
    await collector.handlers.collect(button);

    expect(startPrivateGame).not.toHaveBeenCalled();
    expect(button.update).toHaveBeenCalled();
    expect(JSON.stringify(button.update.mock.calls)).toContain('Private game creation cancelled');
    expect(collector.stop).toHaveBeenCalledWith('cancelled');
  });

  it('rejects confirmation clicks from non-leaders', async () => {
    const { target, collector } = interaction('private');

    await party(target, ws());
    const confirmId = buttonIds(target).find(id => id.startsWith('private_confirm_'))!;
    const button = click(confirmId, '999999999999999999');
    await collector.handlers.collect(button);

    expect(startPrivateGame).not.toHaveBeenCalled();
    expect(button.reply).toHaveBeenCalled();
    expect(JSON.stringify(button.reply.mock.calls)).toContain('Only the party leader');
  });

  it('surfaces private game creation failures after confirmation', async () => {
    startPrivateGame.mockResolvedValue({ success: false, message: 'Party members already in a queue: A' });
    const { target, collector } = interaction('private');

    await party(target, ws());
    const confirmId = buttonIds(target).find(id => id.startsWith('private_confirm_'))!;
    const button = click(confirmId);
    await collector.handlers.collect(button);

    expect(JSON.stringify(button.editReply.mock.calls)).toContain('Party members already in a queue: A');
  });

  it('expires the confirmation when nobody responds', async () => {
    const { target, collector, message } = interaction('private');

    await party(target, ws());
    await collector.handlers.end([], 'time');

    expect(message.edit).toHaveBeenCalled();
    expect(JSON.stringify(message.edit.mock.calls)).toContain('confirmation has expired');
  });

  it('requires the game service to be available', async () => {
    const { target } = interaction();

    await party(target, undefined);

    expect(startPrivateGame).not.toHaveBeenCalled();
    expect(replyText(target)).toContain('game service is not ready');
  });

  it('cancels the active private game', async () => {
    cancelPrivateGame.mockResolvedValue({ success: true, gameId: 7 });
    const target = interaction('cancel').target;
    const manager = ws();

    await party(target, manager);

    expect(cancelPrivateGame).toHaveBeenCalledWith(UID, manager);
    expect(replyText(target)).toContain('Private game #7 has been cancelled');
  });

  it('surfaces cancellation failures', async () => {
    cancelPrivateGame.mockResolvedValue({ success: false, message: 'Your party does not have an active private game' });
    const target = interaction('cancel').target;

    await party(target, ws());

    expect(replyText(target)).toContain('does not have an active private game');
  });
});
