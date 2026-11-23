import { handlePunishmentIssuer, sendPunishmentEmbed } from '../src/utils/punishmentEmbed';
import { EMBED_THEME } from '../src/utils/betterembed';

jest.mock('../src/models/PunishmentAction', () => ({
  __esModule: true,
  default: { create: jest.fn(), findById: jest.fn() },
}));
jest.mock('../src/services/PermissionService', () => ({
  PermissionService: { rolesFor: jest.fn(() => ['staff-role']) },
}));
const PunishmentAction = require('../src/models/PunishmentAction').default;
beforeEach(() => {
  PunishmentAction.create.mockResolvedValue({ _id: 'act1' });
});

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    channels: { punishmentsChannel: 'punish-channel' },
  },
}));

interface SentPayload {
  content?: unknown;
  embeds: any[];
  components?: any[];
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
    channels: {
      cache: { get: (id: string) => (id === 'punish-channel' ? channel ?? undefined : undefined) },
      fetch: jest.fn().mockResolvedValue(channel),
    },
  } as any;
}

function sent(channel: ReturnType<typeof channelMock>): SentPayload {
  return channel.send.mock.calls[0][0] as SentPayload;
}

const fieldsOf = (embed: any) => Object.fromEntries((embed.fields || []).map((f: any) => [f.name, f.value]));
const EXPIRY = new Date(Date.now() + 7 * 86400000);
const TARGET = '123456789012345678';

describe('punishment embeds', () => {
  it('renders an issued mute with duration, expiry, staff and the Details button', async () => {
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
    const embed = payload.embeds[0].toJSON();
    const fields = fieldsOf(embed);

    expect(payload.content).toBe(`<@${TARGET}>`);
    expect(payload.files).toBeUndefined();
    expect(embed.author?.name).toBe(`${EMBED_THEME.brandName} · Punishment`);
    expect(embed.title).toBeUndefined();
    expect(embed.color).toBe(0xff9900);
    expect(embed.description).toContain(`<@${TARGET}> has been 🔇 muted.`);
    expect(embed.description).toContain('> **Reason:** Racism, Slurs or Hate Speech `#A1B2C`');
    expect(fields.Duration).toBe('`7d`');
    expect(fields.Expires).toBe(`<t:${Math.floor(EXPIRY.getTime() / 1000)}:R>`);
    expect(fields.Staff).toBe('> <@mod-1>');
    expect(embed.footer?.text).toContain('appeal');

    const button = payload.components?.[0]?.toJSON().components[0];
    expect(button.custom_id).toBe(`punishment:details:mute:${TARGET}:A1B2C`);
    expect(button.label).toBe('Details');
  });

  it('renders a ranked ban in dark red, permanent when there is no expiry', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: TARGET,
      moderatorId: 'mod-1',
      reason: 'Cheating',
      type: 'ban',
    });

    const embed = sent(channel).embeds[0].toJSON();
    const fields = fieldsOf(embed);
    expect(embed.color).toBe(0x7b0606);
    expect(embed.description).toContain('has been 🔨 rank banned.');
    expect(fields.Duration).toBe('`Permanent`');
    expect(fields.Expires).toBe('`Never`');
    expect(fields.Staff).toBeUndefined();
    expect(JSON.stringify(embed)).not.toContain('mod-1');
    const button = sent(channel).components?.[0]?.toJSON().components[0];
    expect(button.custom_id).toBe('punishment:issuer:act1');
    expect(button.label).toBe('Details');
    expect(button.emoji?.name).toBe('📖');
    expect(PunishmentAction.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'ban', moderatorId: 'mod-1', source: 'discord' }));
  });

  it('records an in-game ban as issued in Minecraft by the staff member', async () => {
    const channel = channelMock();
    await sendPunishmentEmbed({ guild: guildWith(channel), targetId: TARGET, moderatorId: 'bot', reason: 'x', type: 'ban',
      caseId: 'C1', staff: 'Mod1', source: 'minecraft' });
    expect(PunishmentAction.create).toHaveBeenCalledWith(expect.objectContaining({ staff: 'Mod1', source: 'minecraft', caseId: 'C1' }));
    const ids = sent(channel).components?.[0]?.toJSON().components.map((c: any) => c.custom_id);
    expect(ids).toEqual(['punishment:issuer:act1']);
  });

  it('still posts a ban when who issued it could not be recorded', async () => {
    PunishmentAction.create.mockRejectedValue(new Error('db down'));
    const channel = channelMock();
    await sendPunishmentEmbed({ guild: guildWith(channel), targetId: TARGET, moderatorId: 'mod-1', reason: 'x', type: 'ban' });
    expect(sent(channel).components).toEqual([]);
  });

  it('renders a strike without duration fields', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: TARGET,
      moderatorId: 'mod-1',
      reason: 'Toxicity',
      type: 'strike',
      caseId: '4840E',
    });

    const embed = sent(channel).embeds[0].toJSON();
    const fields = fieldsOf(embed);
    expect(embed.color).toBe(0xcda12f);
    expect(embed.description).toContain('has been issued a ⭐ strike.');
    expect(fields.Duration).toBeUndefined();
    expect(fields.Expires).toBeUndefined();
  });

  it.each([
    ['unmute', 'has been 🔊 unmuted'],
    ['unban', 'has been ✅ unbanned'],
    ['unstrike', 'had a ⭐ strike removed'],
  ] as const)('renders a %s in the brand colour without the appeal footer', async (type, phrase) => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: TARGET,
      moderatorId: 'system',
      reason: 'mistake',
      type,
    });

    const embed = sent(channel).embeds[0].toJSON();
    expect(embed.description).toContain(`${phrase}.`);
    expect(embed.color).toBe(EMBED_THEME.successColor);
    expect(embed.footer).toBeUndefined();
    expect(fieldsOf(embed).Expired).toBe(type === 'unban' ? undefined : '> System');
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
