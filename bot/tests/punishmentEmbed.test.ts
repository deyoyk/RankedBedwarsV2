import { sendPunishmentEmbed } from '../src/utils/punishmentEmbed';
import { EMBED_THEME } from '../src/utils/betterembed';

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
    // No record ID, so no Details button
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
    expect(fieldsOf(embed).Expired).toBe('> System');
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
