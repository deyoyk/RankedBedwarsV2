import config from '../src/config/config';

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
  winStreak: 4,
  loseStreak: 0,
  wlr: 5,
  kdr: 6,
  finalKills: 7,
  bedBroken: 8,
  finalDeaths: 1,
  playtimeSeconds: 7200,
  experience: 100,
  recentGames: [],
  createdAt: new Date('2024-01-01T00:00:00Z'),
});

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    aggregate: jest.fn(),
  },
}));
jest.mock('../src/models/Season', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockImplementation(() => ({ lean: jest.fn().mockResolvedValue(null) })) },
}));

const captured: { playerData?: any; helpers?: any; bufferCalls: number } = { bufferCalls: 0 };
jest.mock('../src/themes', () => ({
  resolveTheme: jest.fn(() => async (playerData: any, recentGames: any, helpers: any) => {
    captured.playerData = playerData;
    captured.helpers = helpers;
    captured.bufferCalls += 1;
    return Buffer.from('img');
  }),
  themes: ['default'],
}));

const UserModel = require('../src/models/User').default;

function interaction() {
  return {
    content: '=stats @x',
    author: { id: '1' },
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

describe('stats ranks via single facet aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    captured.playerData = undefined;
    captured.helpers = undefined;
    captured.bufferCalls = 0;
    UserModel.findOne.mockImplementation(() => chainable(makeUser()));
  });

  it('sends exactly one aggregate with all rank buckets and computes #n ranks', async () => {
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
    const { stats } = await import('../src/commands/stats/stats');
    const msg = interaction();
    await stats(msg, ['<@123456789012345678>'], undefined);
    expect(msg.reply).toHaveBeenCalled();
    expect(UserModel.aggregate).toHaveBeenCalledTimes(1);
    expect(UserModel.countDocuments).toBeUndefined();
    const byLabel: Record<string, string> = {};
    for (const t of captured.playerData.tiles) byLabel[t.label] = t.rank;
    expect(byLabel['Wins']).toBe('#5');
    expect(byLabel['Losses']).toBe('#1');
    expect(byLabel['W/L ratio']).toBe('#2');
    expect(byLabel['Total Kills']).toBe('#1');
    expect(byLabel['K/D ratio']).toBe('#3');
    expect(byLabel['MVPs']).toBe('#10');
    expect(byLabel['Streak']).toBe('#4');
    expect(byLabel['Playtime']).toBe('#6');
    const combat: Record<string, string> = {};
    for (const c of captured.playerData.combat) combat[c.label] = c.rank;
    expect(combat['Final Kills']).toBe('#7');
    expect(combat['Beds Broken']).toBe('#8');
    expect(combat['Final Deaths']).toBe('#9');
    await expect(captured.helpers.calculatePosition('anyone')).resolves.toBe(11);
    expect(captured.helpers.calculateRating(captured.playerData)).toBe(1000);
  });

  it('defaults missing buckets to rank #1', async () => {
    UserModel.aggregate.mockResolvedValue([{}]);
    const { stats } = await import('../src/commands/stats/stats');
    const msg = interaction();
    await stats(msg, ['<@123456789012345678>'], undefined);
    const ranks = captured.playerData.tiles.map((t: any) => t.rank);
    expect(ranks.every((r: string) => r === '#1')).toBe(true);
    await expect(captured.helpers.calculatePosition('anyone')).resolves.toBe(1);
  });
});
