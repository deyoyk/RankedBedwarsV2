const makeUser = () => ({
  discordId: '1',
  ign: 'Steve',
  wins: 10,
  losses: 2,
  games: 12,
  kills: 30,
  deaths: 5,
  mvps: 3,
  elo: 1000,
  peakElo: 1100,
  winStreak: 4,
  loseStreak: 1,
  bestStreak: 6,
  wlr: 5,
  kdr: 6,
  finalKills: 7,
  bedBroken: 8,
  finalDeaths: 1,
  diamonds: 12,
  irons: 34,
  gold: 56,
  emeralds: 7,
  blocksPlaced: 890,
  damageDealt: 1234,
  damageTaken: 567,
  assists: 12,
  firstBloods: 2,
  playtimeSeconds: 7200,
  level: 3,
  experience: 100,
  recentGames: [{ gameId: 1 }],
  currentTheme: 'default',
  seasonNumber: 2,
  chapterNumber: 1,
  isBanned: false,
  isFrozen: false,
  isMuted: false,
  strikes: [],
  mutes: [],
  bans: [],
  statResets: [{ date: new Date('2026-01-01T00:00:00Z') }],
  eloClaims: [],
  createdAt: new Date('2024-01-01T00:00:00Z'),
  lastPlayedAt: new Date('2026-01-01T00:00:00Z'),
});

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    aggregate: jest.fn(),
  },
}));
jest.mock('../src/models/Season', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(null) })) },
}));

const UserModel = require('../src/models/User').default;

function interaction() {
  return {
    id: 'interaction-info',
    user: { id: '1' },
    options: {
      getUser: jest.fn(() => ({ id: '123456789012345678' })),
      getString: jest.fn(() => null),
      getInteger: jest.fn(() => null),
    },
    guild: { id: 'g1' },
    channel: { id: 'c1' },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function chainable(value: any) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function fieldsByEmbed(payload: any): Record<string, string> {
  const fields = payload.embeds[0].toJSON().fields;
  return Object.fromEntries(fields.map((field: any) => [field.name, field.value]));
}

describe('info command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    UserModel.findOne.mockImplementation(() => chainable(makeUser()));
  });

  it('sends one detailed embed with all stats and ranks', async () => {
    UserModel.aggregate.mockImplementation(async (pipeline: any[]) => {
      expect(pipeline).toHaveLength(1);
      expect(Object.keys(pipeline[0].$facet).sort()).toEqual([
        'bedBrokenRank',
        'finalDeathsRank',
        'finalKillsRank',
        'kdrRank',
        'killsRank',
        'lossesRank',
        'mvpsRank',
        'playtimeSecondsRank',
        'position',
        'winStreakRank',
        'winsRank',
        'wlrRank',
      ].sort());
      return [{
        winsRank: [{ n: 4 }],
        lossesRank: [],
        wlrRank: [{ n: 1 }],
        killsRank: [{ n: 0 }],
        kdrRank: [{ n: 2 }],
        mvpsRank: [{ n: 9 }],
        winStreakRank: [{ n: 3 }],
        playtimeSecondsRank: [{ n: 5 }],
        finalKillsRank: [{ n: 6 }],
        bedBrokenRank: [{ n: 7 }],
        finalDeathsRank: [{ n: 8 }],
        position: [{ n: 10 }],
      }];
    });

    const { info } = await import('../src/commands/stats/info');
    const msg = interaction();
    await info(msg);

    expect(msg.reply).toHaveBeenCalled();
    const payload = msg.reply.mock.calls[0][0];
    expect(payload.files).toBeUndefined();
    expect(payload.embeds).toHaveLength(1);
    expect(UserModel.aggregate).toHaveBeenCalledTimes(1);

    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('Info: Steve');
    expect(embed.description).toContain('<@1>');

    const fields = fieldsByEmbed(payload);
    expect(fields.Account).toContain('**IGN:** Steve');
    expect(fields.Account).toContain('**Status:** Active');
    expect(fields.Account).toContain('**Theme:** default');

    expect(fields.Progress).toContain('**ELO:** 1,000 (#11)');
    expect(fields.Progress).toContain('**Peak ELO:** 1,100');
    expect(fields.Progress).toContain('**Level:** 3');
    expect(fields.Progress).toContain('**Playtime:** 2h (#6)');

    expect(fields.Record).toContain('**Games:** 12');
    expect(fields.Record).toContain('**Wins:** 10 (#5)');
    expect(fields.Record).toContain('**Losses:** 2 (#1)');
    expect(fields.Record).toContain('**W/L:** 5.00 (#2)');
    expect(fields.Record).toContain('**MVPs:** 3 (#10)');
    expect(fields.Record).toContain('**Win Streak:** 4 (#4)');

    expect(fields.Combat).toContain('**Kills:** 30 (#1)');
    expect(fields.Combat).toContain('**K/D:** 6.00 (#3)');
    expect(fields.Combat).toContain('**Final Kills:** 7 (#7)');
    expect(fields.Combat).toContain('**Beds Broken:** 8 (#8)');
    expect(fields.Combat).toContain('**Final Deaths:** 1 (#9)');
    expect(fields.Combat).toContain('**Damage Dealt:** 1,234');

    expect(fields.Resources).toContain('**Diamonds:** 12');
    expect(fields.Resources).toContain('**Irons:** 34');
    expect(fields.Resources).toContain('**Gold:** 56');
    expect(fields.Resources).toContain('**Emeralds:** 7');
    expect(fields.Resources).toContain('**Blocks Placed:** 890');
    expect(fields.Moderation).toContain('**Stat Resets:** 1');
    expect(fields.Moderation).toContain('**Recent Games Stored:** 1');
  });

  it('defaults missing rank buckets to #1', async () => {
    UserModel.aggregate.mockResolvedValue([{}]);
    const { info } = await import('../src/commands/stats/info');
    const msg = interaction();
    await info(msg);

    const fields = fieldsByEmbed(msg.reply.mock.calls[0][0]);
    expect(fields.Progress).toContain('**ELO:** 1,000 (#1)');
    expect(fields.Record).toContain('**Wins:** 10 (#1)');
    expect(fields.Combat).toContain('**Kills:** 30 (#1)');
  });
});
