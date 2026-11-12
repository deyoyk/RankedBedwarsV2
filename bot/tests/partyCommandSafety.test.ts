jest.mock('../src/services/PartyService', () => ({
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

import { party } from '../src/commands/queue/party';
import { PartyService } from '../src/services/PartyService';

const UID = '123456789012345678';
const BOT_ID = '123456789012345679';
const mockedJoin = PartyService.joinParty as jest.MockedFunction<typeof PartyService.joinParty>;
const mockedUpdate = PartyService.updatePartySettings as jest.MockedFunction<typeof PartyService.updatePartySettings>;

function partyDoc() {
  return {
    partyId: 'P',
    leader: UID,
    members: [UID],
    maxMembers: 8,
    isPrivate: false,
    description: '',
  } as any;
}

function interaction(action = 'invite', targetUser?: any) {
  const guild = { id: 'guild-1' };
  return {
    id: `interaction-${action}`,
    guild,
    user: { id: UID },
    channelId: 'channel-1',
    client: { users: { cache: { get: jest.fn() } } },
    options: {
      getSubcommand: () => action,
      getString: () => null,
      getUser: () => targetUser ?? null,
    },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function replyText(target: any): string {
  return JSON.stringify(target.reply.mock.calls);
}

describe('party command safety', () => {
  beforeEach(() => jest.clearAllMocks());

    it('rejects self-invites before calling the service', async () => {
    const target = interaction('invite', { id: UID, bot: false });

    await party(target);

    expect(PartyService.inviteToParty).not.toHaveBeenCalled();
    expect(replyText(target)).toContain("can't invite yourself");
  });

  it('rejects bot invites before calling the service', async () => {
    const target = interaction('invite', { id: BOT_ID, bot: true });

    await party(target);

    expect(PartyService.inviteToParty).not.toHaveBeenCalled();
    expect(replyText(target)).toContain("can't invite a bot");
  });
});
