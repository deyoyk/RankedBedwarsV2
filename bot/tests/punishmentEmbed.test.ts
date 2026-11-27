import { MessageFlags } from 'discord.js';
import { handlePunishmentDetails, handlePunishmentIssuer, sendPunishmentEmbed } from '../src/utils/punishmentEmbed';

jest.mock('../src/models/PunishmentAction', () => ({
  __esModule: true,
  default: { create: jest.fn(), findById: jest.fn() },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../src/services/PermissionService', () => ({
  PermissionService: { rolesFor: jest.fn(() => ['staff-role']) },
}));
const PunishmentAction = require('../src/models/PunishmentAction').default;
const User = require('../src/models/User').default;
const mockConfig = require('../src/config/config').default;
beforeEach(() => {
  PunishmentAction.create.mockReset().mockResolvedValue({ _id: 'act1' });
  User.findOne.mockReset().mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ ign: 'TTSBot' }) }) });
  mockConfig.channels.supportChannel = 'support-1';
  mockConfig.storeUrl = '';
  mockConfig.punishmentStaffId = 'staff-shown';
});

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    channels: { punishmentsChannel: 'punish-channel', supportChannel: 'support-1' },
    storeUrl: '',
    punishmentStaffId: 'staff-shown',
  },
}));

interface SentPayload {
  content?: unknown;
  embeds?: unknown[];
  components: any[];
  flags?: number;
  allowedMentions?: unknown;
  files?: Array<{ attachment: string; name: string }>;
}

function channelMock() {
  return {
    isTextBased: () => true,
    send: jest.fn().mockResolvedValue({}),
  };
}

function guildWith(channel: ReturnType<typeof channelMock> | null) {
  return {
    client: { user: { id: 'bot-1' } },
    channels: {
      cache: { get: (id: string) => (id === 'punish-channel' ? channel ?? undefined : undefined) },
      fetch: jest.fn().mockResolvedValue(channel),
    },
  } as any;
}

function sent(channel: ReturnType<typeof channelMock>): SentPayload {
  return channel.send.mock.calls[0][0] as SentPayload;
}

/** The card's container, all of its text, and every button in it. */
function card(payload: SentPayload) {
  const container = payload.components[0].toJSON();
  const texts: string[] = [];
  const buttons: any[] = [];
  let thumbnail: string | undefined;
  for (const part of container.components) {
    if (part.type === 10) texts.push(part.content);
    if (part.type === 9) {
      texts.push(...part.components.map((c: any) => c.content));
      if (part.accessory.type === 11) thumbnail = part.accessory.media.url;
      if (part.accessory.type === 2) buttons.push(part.accessory);
    }
    if (part.type === 1) buttons.push(...part.components);
  }
  return { container, text: texts.join('\n'), buttons, thumbnail };
}

const EXPIRY = new Date(Date.UTC(2026, 10, 18, 12));
const TARGET = '123456789012345678';

describe('punishment posts', () => {
  it('lays out a mute like the rank ban card: player, reason, staff, expiry and appeal', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: TARGET,
      moderatorId: 'mod-1',
      reason: 'Racism, Slurs or Hate Speech',
      type: 'mute',
      expires: EXPIRY,
      caseId: 'A1B2C',
    });

    const payload = sent(channel);
    const { container, text, buttons, thumbnail } = card(payload);

    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.content).toBeUndefined();
    expect(payload.embeds).toBeUndefined();
    expect(payload.allowedMentions).toEqual({ users: [TARGET] });
    expect(container.accent_color).toBe(0xff9900);
    expect(text).toContain('### Mute');
    expect(text).toContain(`> **Player:** <@${TARGET}> (TTSBot)`);
    expect(text).toContain('> **Reason:** `Racism, Slurs or Hate Speech` `#A1B2C`');
    expect(text).toContain('> **Staff:** <@staff-shown>');
    expect(text).not.toContain('mod-1');
    expect(text).toContain(`> **Expires:** \`18/11/2026\` [<t:${Math.floor(EXPIRY.getTime() / 1000)}:R>]`);
    expect(text).toContain('-# If you wish to appeal, open a ticket in <#support-1>');
    expect(thumbnail).toBe('attachment://mute.png');
    expect(payload.files?.[0].name).toBe('mute.png');
    expect(buttons.map(b => b.custom_id)).toEqual([`punishment:details:mute:${TARGET}:A1B2C`]);
  });

  it('hides the moderator on a permanent rank ban', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: TARGET,
      moderatorId: 'mod-1',
      reason: 'Anticheat Ban (3rd)',
      type: 'ban',
    });

    const { container, text, buttons, thumbnail } = card(sent(channel));
    expect(container.accent_color).toBe(0xa50e1e);
    expect(text).toContain('### Rank Ban');
    expect(text).toContain('> **Staff:** <@staff-shown>');
    expect(text).toContain('> **Expires:** `Never`');
    expect(text).not.toContain('mod-1');
    expect(thumbnail).toBe('attachment://ban.png');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].custom_id).toBe('punishment:issuer:act1');
    expect(buttons[0].emoji?.name).toBe('📖');
    expect(PunishmentAction.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'ban', moderatorId: 'mod-1', source: 'discord' }));
  });

  it('puts a Buy Unban link next to the appeal line when a store is set', async () => {
    mockConfig.storeUrl = 'https://store.example.com';
    const channel = channelMock();
    await sendPunishmentEmbed({ guild: guildWith(channel), targetId: TARGET, moderatorId: 'mod-1', reason: 'x', type: 'ban', expires: EXPIRY });

    const { container, buttons } = card(sent(channel));
    const appeal = container.components.find((c: any) => c.type === 9 && c.accessory.type === 2);
    expect(appeal.accessory).toMatchObject({ label: 'Buy Unban', url: 'https://store.example.com', style: 5 });
    expect(buttons.map(b => b.custom_id ?? b.label)).toEqual(['Buy Unban', 'punishment:issuer:act1']);
  });

  it('records an in-game ban as issued in Minecraft by the staff member', async () => {
    const channel = channelMock();
    await sendPunishmentEmbed({ guild: guildWith(channel), targetId: TARGET, moderatorId: 'bot', reason: 'x', type: 'ban',
      caseId: 'C1', staff: 'Mod1', source: 'minecraft' });
    expect(PunishmentAction.create).toHaveBeenCalledWith(expect.objectContaining({ staff: 'Mod1', source: 'minecraft', caseId: 'C1' }));
    expect(card(sent(channel)).buttons.map(b => b.custom_id)).toEqual(['punishment:issuer:act1']);
  });

  it('still posts a ban when who issued it could not be recorded', async () => {
    PunishmentAction.create.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const channel = channelMock();
    await sendPunishmentEmbed({ guild: guildWith(channel), targetId: TARGET, moderatorId: 'mod-1', reason: 'x', type: 'ban' });
    expect(card(sent(channel)).buttons).toEqual([]);
    error.mockRestore();
  });

  it('leaves the name out when the player is not registered', async () => {
    User.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });
    const channel = channelMock();
    await sendPunishmentEmbed({ guild: guildWith(channel), targetId: TARGET, moderatorId: 'mod-1', reason: 'x', type: 'strike' });
    expect(card(sent(channel)).text).toContain(`> **Player:** <@${TARGET}>\n`);
  });

  it('falls back to the bot as staff when no staff account is set', async () => {
    mockConfig.punishmentStaffId = '';
    const channel = channelMock();
    await sendPunishmentEmbed({ guild: guildWith(channel), targetId: TARGET, moderatorId: 'mod-1', reason: 'x', type: 'strike' });
    expect(card(sent(channel)).text).toContain('> **Staff:** <@bot-1>');
  });

  it('renders a strike without an expiry', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: TARGET,
      moderatorId: 'mod-1',
      reason: 'Toxicity',
      type: 'strike',
      caseId: '4840E',
    });

    const { container, text } = card(sent(channel));
    expect(container.accent_color).toBe(0xcda12f);
    expect(text).toContain('### Strike');
    expect(text).not.toContain('Expires');
  });

  it.each([
    ['unmute', 'Unmute', '> **Expired:** System'],
    ['unban', 'Rank Unban', '> **Expired:** System'],
    ['unstrike', 'Strike Removed', '> **Expired:** System'],
  ] as const)('renders a %s in green without the appeal line', async (type, title, staff) => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: TARGET,
      moderatorId: 'system',
      reason: 'mistake',
      type,
    });

    const { container, text, thumbnail } = card(sent(channel));
    expect(text).toContain(`### ${title}`);
    expect(text).toContain(staff);
    expect(container.accent_color).toBe(0x2ecc71);
    expect(text).not.toContain('appeal');
    expect(thumbnail).toBe('attachment://unbanunmute.png');
  });

  it('does not throw when the punishments channel is missing', async () => {
    const guild = {
      channels: {
        cache: { get: () => undefined },
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as any;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(sendPunishmentEmbed({
      guild,
      targetId: TARGET,
      moderatorId: 'mod-1',
      reason: 'test',
      type: 'mute',
    })).resolves.toBeUndefined();

    warn.mockRestore();
  });
});

describe('the Details button on bans', () => {
  const click = (roles: string[], admin = false) => ({
    customId: 'punishment:issuer:act1',
    memberPermissions: { has: () => admin },
    member: { roles: { cache: { has: (id: string) => roles.includes(id) } } },
    client: { user: { id: 'bot' } },
    reply: jest.fn(),
  }) as any;
  const text = (i: any) => i.reply.mock.calls[0][0].embeds[0].toJSON().description as string;

  it('is refused to anyone who is not staff', async () => {
    const i = click(['member']);
    await handlePunishmentIssuer(i);
    expect(text(i)).toContain('Only staff');
    expect(PunishmentAction.findById).not.toHaveBeenCalled();
  });

  it('shows staff who issued it, when and where', async () => {
    PunishmentAction.findById.mockReturnValue({ lean: () => Promise.resolve({
      type: 'unban', targetId: TARGET, moderatorId: 'bot', staff: 'Mod1', source: 'minecraft', date: new Date(1000000)
    }) });
    const i = click(['staff-role']);
    await handlePunishmentIssuer(i);
    expect(text(i)).toContain('**Issued by:** `Mod1`');
    expect(text(i)).toContain('**Where:** Minecraft');
    expect(text(i)).toContain('<t:1000:f>');
    expect(i.reply.mock.calls[0][0].flags).toBeDefined();
  });

  it('shows admins a Discord ban by mention', async () => {
    PunishmentAction.findById.mockReturnValue({ lean: () => Promise.resolve({
      type: 'ban', targetId: TARGET, moderatorId: '222222222222222222', source: 'discord', caseId: 'C9', date: new Date()
    }) });
    const i = click([], true);
    await handlePunishmentIssuer(i);
    expect(text(i)).toContain('**Issued by:** <@222222222222222222>');
    expect(text(i)).toContain('**Where:** Discord');
    expect(text(i)).toContain('`#C9`');
  });
});

describe('the Details button on mutes and strikes', () => {
  const click = (roles: string[]) => ({
    customId: `punishment:details:mute:${TARGET}:M1`,
    memberPermissions: { has: () => false },
    member: { roles: { cache: { has: (id: string) => roles.includes(id) } } },
    reply: jest.fn(),
  }) as any;
  const text = (i: any) => i.reply.mock.calls[0][0].embeds[0].toJSON().description as string;
  beforeEach(() => {
    User.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({
      ign: 'Parady', mutes: [{ id: 'M1', reason: 'Toxicity', date: new Date(), moderator: 'mod-1', duration: 60 }]
    }) }) });
  });

  it('hides who issued it from players', async () => {
    const i = click(['member']);
    await handlePunishmentDetails(i);
    expect(text(i)).toContain('**Reason:** Toxicity');
    expect(text(i)).not.toContain('mod-1');
  });

  it('shows staff who issued it', async () => {
    const i = click(['staff-role']);
    await handlePunishmentDetails(i);
    expect(text(i)).toContain('**Staff:** <@mod-1>');
  });
});
