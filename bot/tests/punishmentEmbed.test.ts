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

const EXPIRY = new Date(2026, 10, 13, 12, 0, 0);

describe('punishment embeds', () => {
  it('renders an issued mute with duration and reason', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: '123456789012345678',
      moderatorId: 'mod-1',
      reason: 'Racism, Slurs or Hate Speech',
      type: 'mute',
      expires: EXPIRY,
    });

    const payload = sent(channel);
    const embed = payload.embeds[0].toJSON();

    expect(payload.content).toBe('<@123456789012345678>');
    expect(payload.files).toBeUndefined();
    expect(embed.title).toBe('Warning: Mute');
    expect(embed.color).toBe(EMBED_THEME.warningColor);
    expect(embed.description).toContain('has been issued a Mute punishment.');
    expect(embed.description).not.toContain('<@');
    expect(embed.description).toContain('**Duration:**');
    expect(embed.description).toContain('**Expires:** 13-11-2026');
    expect(embed.description).toContain('**Reason:** Racism, Slurs or Hate Speech');
    expect(embed.thumbnail).toBeUndefined();
  });

  it('renders a ranked ban with the queue restriction line', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: '123456789012345678',
      moderatorId: 'mod-1',
      reason: '[SS] Refusing to Screenshare',
      type: 'ban',
      expires: EXPIRY,
    });

    const payload = sent(channel);
    const embed = payload.embeds[0].toJSON();

    expect(payload.content).toBe('<@123456789012345678>');
    expect(embed.title).toBe('Punishment: Ranked Ban');
    expect(embed.color).toBe(EMBED_THEME.punishmentColor);
    expect(embed.description).toContain('has been issued a Ranked Ban punishment.');
    expect(embed.description).not.toContain('<@');
    expect(embed.description).toContain('Player is no longer able to queue.');
    expect(embed.thumbnail).toBeUndefined();
  });

  it('renders a strike without a duration line', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: '123456789012345678',
      moderatorId: 'mod-1',
      reason: 'Teaming',
      type: 'strike',
    });

    const payload = sent(channel);
    const embed = payload.embeds[0].toJSON();

    expect(payload.content).toBe('<@123456789012345678>');
    expect(embed.title).toBe('Warning: Strike');
    expect(embed.color).toBe(EMBED_THEME.warningColor);
    expect(embed.description).toContain('has been issued a Strike punishment.');
    expect(embed.description).not.toContain('<@');
    expect(embed.description).not.toContain('**Duration:**');
    expect(embed.thumbnail).toBeUndefined();
  });

  it('renders a mute removal', async () => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: '123456789012345678',
      moderatorId: 'mod-1',
      reason: 'mistake',
      type: 'unmute',
    });

    const payload = sent(channel);
    const embed = payload.embeds[0].toJSON();

    expect(payload.content).toBe('<@123456789012345678>');
    expect(embed.title).toBe('Success: Mute Removed');
    expect(embed.color).toBe(EMBED_THEME.successColor);
    expect(embed.description).toContain('is no longer muted.');
    expect(embed.description).not.toContain('<@');
    expect(embed.description).toContain('**Type:** Mute');
    expect(embed.description).toContain('**Reason:** mistake');
    expect(embed.description).toMatch(/\*\*Processed:\*\* \w+, \d+ \w+, \d{4} \d{2}:\d{2}/);
    expect(embed.thumbnail).toBeUndefined();
  });

  it.each([
    ['unban', 'Success: Ban Removed', 'is no longer banned', 'Ranked Ban'],
    ['unstrike', 'Success: Strike Removed', 'has had their strike removed', 'Strike'],
  ])('renders %s removals with the right title and wording', async (type, title, phrase, label) => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: '123456789012345678',
      moderatorId: 'mod-1',
      reason: 'appeal accepted',
      type: type as any,
    });

    const payload = sent(channel);
    const embed = payload.embeds[0].toJSON();
    expect(payload.content).toBe('<@123456789012345678>');
    expect(embed.title).toBe(title);
    expect(embed.description).toContain(`${phrase}.`);
    expect(embed.description).toContain(`**Type:** ${label}`);
    expect(embed.description).not.toContain('<@');
    expect(embed.color).toBe(EMBED_THEME.successColor);
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
      targetId: '123456789012345678',
      moderatorId: 'mod-1',
      reason: 'test',
      type: 'mute',
    })).resolves.toBeUndefined();

    warn.mockRestore();
  });
});
