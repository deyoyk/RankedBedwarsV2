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

function replyText(target: any): string {
  return JSON.stringify(target.reply.mock.calls);
}

describe('party command safety', () => {
  beforeEach(() => jest.clearAllMocks());

  it('supports prefix party join with the party id', async () => {
    mockedJoin.mockResolvedValue({ success: true, party: partyDoc() });
    const target = interaction();

    await party(target, ['join', 'P']);

    expect(mockedJoin).toHaveBeenCalledWith(UID, 'P', target.guild);
    expect(replyText(target)).toContain('successfully joined the party');
  });

  it('supports prefix party settings', async () => {
    mockedUpdate.mockResolvedValue({ success: true, party: partyDoc() });
    const target = interaction();

    await party(target, ['settings', 'private', 'true']);

    expect(mockedUpdate).toHaveBeenCalledWith(UID, 'private', 'true');
    expect(replyText(target)).toContain('Party settings updated');
  });

  it('rejects self-invites before calling the service', async () => {
    const target = interaction();
    target.client.users.cache.get.mockReturnValue({ id: UID, bot: false });

    await party(target, ['invite', `<@${UID}>`]);

    expect(PartyService.inviteToParty).not.toHaveBeenCalled();
    expect(replyText(target)).toContain('cannot invite yourself');
  });

  it('rejects bot invites before calling the service', async () => {
    const target = interaction();
    target.client.users.cache.get.mockReturnValue({ id: BOT_ID, bot: true });

    await party(target, ['invite', `<@${BOT_ID}>`]);

    expect(PartyService.inviteToParty).not.toHaveBeenCalled();
    expect(replyText(target)).toContain('cannot invite a bot');
  });
});
