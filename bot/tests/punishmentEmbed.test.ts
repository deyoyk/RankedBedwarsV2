import { sendPunishmentEmbed } from '../src/utils/punishmentEmbed';

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
  it('renders an issued mute with duration, reason, and the mute image', async () => {
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

    expect(payload.content).toBeUndefined();
    expect(embed.title).toBe('PLAYER PUNISHED');
    expect(embed.color).toBe(0x992D22);
    expect(embed.description).toContain('has been issued a **Mute** punishment.');
    expect(embed.description).toContain('The punishment duration is **');
    expect(embed.description).toContain('Expiring 13-11-2026');
    expect(embed.description).toContain('The punishment reason is **Racism, Slurs or Hate Speech**');
    expect(embed.thumbnail?.url).toBe('attachment://mute.png');
    expect(payload.files?.map(file => file.name)).toEqual(['mute.png']);
  });

  it('renders a ranked ban with the queue restriction line and ban image', async () => {
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

    expect(embed.title).toBe('PLAYER PUNISHED');
    expect(embed.color).toBe(0x71368A);
    expect(embed.description).toContain('has been issued a **Ranked Ban** punishment.');
    expect(embed.description).toContain('Player is no longer able to queue.');
    expect(embed.thumbnail?.url).toBe('attachment://ban.png');
    expect(payload.files?.map(file => file.name)).toEqual(['ban.png']);
  });

  it('renders a strike without a duration line and with the strike image', async () => {
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

    expect(embed.title).toBe('PLAYER PUNISHED');
    expect(embed.color).toBe(0xC27C0E);
    expect(embed.description).toContain('has been issued a **Strike** punishment.');
    expect(embed.description).not.toContain('The punishment duration is');
    expect(embed.thumbnail?.url).toBe('attachment://strike.png');
    expect(payload.files?.map(file => file.name)).toEqual(['strike.png']);
  });

  it('renders a mute deletion in the screenshot style', async () => {
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

    expect(embed.title).toBe('MUTE DELETED');
    expect(embed.color).toBe(0x1ABC9C);
    expect(embed.description).toContain('is no longer muted. Punishment Type: **Mute**.');
    expect(embed.description).toContain('This punishment was deleted for the reason **mistake**.');
    expect(embed.description).toMatch(/Processed \w+, \d+ \w+, \d{4} \d{2}:\d{2}\./);
    expect(embed.thumbnail?.url).toBe('attachment://unbanunmute.png');
    expect(payload.files?.map(file => file.name)).toEqual(['unbanunmute.png']);
  });

  it.each([
    ['unban', 'BAN REMOVED', 'is no longer banned', 'Ranked Ban'],
    ['unstrike', 'STRIKE REMOVED', 'has had their strike removed', 'Strike'],
  ])('renders %s removals with the right title and wording', async (type, title, phrase, label) => {
    const channel = channelMock();

    await sendPunishmentEmbed({
      guild: guildWith(channel),
      targetId: '123456789012345678',
      moderatorId: 'mod-1',
      reason: 'appeal accepted',
      type: type as any,
    });

    const embed = sent(channel).embeds[0].toJSON();
    expect(embed.title).toBe(title);
    expect(embed.description).toContain(`${phrase}. Punishment Type: **${label}**.`);
    expect(embed.color).toBe(0x1ABC9C);
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
