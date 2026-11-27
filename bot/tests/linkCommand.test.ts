const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockCreate = jest.fn();
const mockSafeFix = jest.fn();
const mockRecordAudit = jest.fn();

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

jest.mock('../src/utils/fix', () => ({
  __esModule: true,
  safeFix: (...args: unknown[]) => mockSafeFix(...args),
}));

jest.mock('../src/services/AuditService', () => ({
  __esModule: true,
  auditInteractionContext: () => ({}),
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

import { link } from '../src/commands/account/link';
import { LinkCodes, linkCodes, LINK_CODE_TTL, MAX_WRONG_CODES, WRONG_CODE_WINDOW } from '../src/services/LinkCodes';

const UID = '123456789012345678';

function query(value: unknown) {
  return {
    collation: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function interactionWith(code: string) {
  return {
    user: { id: UID, tag: 'Steve#0001' },
    guild: { id: 'guild-1' },
    guildId: 'guild-1',
    channelId: 'channel-1',
    options: { getString: jest.fn(() => code) },
    replied: false,
    deferred: false,
    reply: jest.fn().mockResolvedValue(undefined),
  } as any;
}

function replyText(interaction: any): string {
  return JSON.stringify(interaction.reply.mock.calls[0][0]);
}

describe('link codes', () => {
  it('give each name one live code, made of 6 easy-to-read characters', () => {
    const codes = new LinkCodes();
    const first = codes.create('Steve', 0);
    const second = codes.create('steve', 0);
    expect(second).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(codes.claim(first, UID, 0)).toEqual({ error: 'invalid' });
    expect(codes.claim(second, UID, 0)).toEqual({ ign: 'steve' });
    expect(codes.claim(second, UID, 0)).toEqual({ error: 'invalid' });
  });

  it('accept the code pasted as the whole command, in any case', () => {
    const codes = new LinkCodes();
    const code = codes.create('Steve', 0);
    expect(codes.claim(` /link code:${code.toLowerCase()} `, UID, 0)).toEqual({ ign: 'Steve' });
  });

  it('expire after 5 minutes', () => {
    const codes = new LinkCodes();
    const code = codes.create('Steve', 0);
    expect(codes.claim(code, UID, LINK_CODE_TTL)).toEqual({ error: 'invalid' });
  });

  it('lock someone out after too many wrong codes, until the window passes', () => {
    const codes = new LinkCodes();
    const code = codes.create('Steve', 0);
    for (let i = 0; i < MAX_WRONG_CODES; i++) {
      expect(codes.claim('AAAAAA', UID, 0)).toEqual({ error: 'invalid' });
    }
    expect(codes.claim(code, UID, 0)).toEqual({ error: 'locked' });
    expect(codes.claim(code, 'someone-else', 0)).toEqual({ ign: 'Steve' });
    const later = codes.create('Alex', WRONG_CODE_WINDOW);
    expect(codes.claim(later, UID, WRONG_CODE_WINDOW)).toEqual({ ign: 'Alex' });
  });
});

describe('/link on Discord', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSafeFix.mockResolvedValue(undefined);
    mockRecordAudit.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({});
  });

  it('registers a new player with the name the code was made for', async () => {
    const interaction = interactionWith(linkCodes.create('Steve'));
    mockFindOne.mockReturnValue(query(null));
    mockFindOneAndUpdate.mockReturnValue(query(null));

    await link(interaction);

    expect(mockCreate).toHaveBeenCalledWith({ discordId: UID, ign: 'Steve' });
    expect(mockSafeFix).toHaveBeenCalledWith(interaction.guild, UID);
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'account.register', after: { ign: 'Steve' } }));
    expect(replyText(interaction)).toContain('linked to **Steve**');
  });

  it('moves a registered player onto their new name', async () => {
    const interaction = interactionWith(linkCodes.create('Steve2'));
    mockFindOne.mockReturnValue(query(null));
    mockFindOneAndUpdate.mockReturnValue(query({ ign: 'Steve' }));

    await link(interaction);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith({ discordId: UID }, { $set: { ign: 'Steve2' } }, { new: false });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'account.relink', before: { ign: 'Steve' }, after: { ign: 'Steve2' },
    }));
    expect(replyText(interaction)).toContain('was **Steve**');
  });

  it("won't take a name someone else already linked", async () => {
    const interaction = interactionWith(linkCodes.create('Steve'));
    mockFindOne.mockReturnValue(query({ discordId: 'other' }));

    await link(interaction);

    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(replyText(interaction)).toContain('another Discord account');
  });

  it('turns down a wrong code without touching the database', async () => {
    const interaction = interactionWith('ZZZZZZ');

    await link(interaction);

    expect(mockFindOne).not.toHaveBeenCalled();
    expect(replyText(interaction)).toContain('wrong or has expired');
  });

  it('reports a name taken at the same moment as taken', async () => {
    const interaction = interactionWith(linkCodes.create('Steve'));
    mockFindOne.mockReturnValue(query(null));
    mockFindOneAndUpdate.mockReturnValue(query(null));
    mockCreate.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

    await link(interaction);

    expect(replyText(interaction)).toContain('another Discord account');
  });
});
