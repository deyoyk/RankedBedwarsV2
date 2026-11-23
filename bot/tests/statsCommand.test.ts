const mockFindOne = jest.fn();
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    countDocuments: jest.fn().mockResolvedValue(6),
  },
}));
const mockRanks = jest.fn();
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: () => ({ select: () => ({ sort: () => ({ lean: () => mockRanks() }) }) }) },
}));
const mockDraw = jest.fn();
jest.mock('../src/assets/stats-theme', () => ({
  resolveTheme: () => (...args: unknown[]) => mockDraw(...args),
}));

import { recentResults, stats } from '../src/commands/stats/stats';
import { getRankInfo } from '../src/utils/rankInfo';

function slash(options: Record<string, unknown> = {}, userId = 'me') {
  return {
    user: { id: userId },
    guild: null,
    client: { guilds: { cache: { first: () => null } } },
    options: {
      getUser: (name: string) => (options[name] as any) ?? null,
      getString: (name: string) => (options[name] as string) ?? null,
    },
    reply: jest.fn().mockResolvedValue({}),
    deferred: false,
    replied: false,
  } as any;
}
const replyText = (i: any) => JSON.stringify(i.reply.mock.calls);

beforeEach(() => {
  jest.clearAllMocks();
  mockRanks.mockResolvedValue([]);
  mockDraw.mockResolvedValue(Buffer.from('png'));
});

describe('stats card', () => {
  it('lists the newest ten games with their results', () => {
    const games = Array.from({ length: 12 }, (_, i) => ({ gameId: i, date: new Date(i * 1000), state: i % 3 === 0 ? 'voided' : 'scored', won: i % 2 === 0 }));
    const recent = recentResults({ recentGames: games } as any);
    expect(recent).toHaveLength(10);
    expect(recent[0]).toEqual({ gameid: 11, result: 'lose' });
    expect(recent[1]).toEqual({ gameid: 10, result: 'win' });
    expect(recent[2]).toEqual({ gameid: 9, result: 'voided' });
  });

  it('sends the card as an image for a registered player', async () => {
    mockFindOne.mockResolvedValue({ discordId: 'me', ign: 'wuwster', elo: 1234, wins: 4, losses: 2, mvps: 1, bedBroken: 3, winStreak: 2, recentGames: [] });
    const interaction = slash();
    await stats(interaction);

    const [playerData, , helpers] = mockDraw.mock.calls[0];
    expect(playerData).toMatchObject({
      ign: 'wuwster', elo: 1234, wins: 4, losses: 2, mvps: 1, wlr: '2.00', beds: 3, streak: 2,
    });
    await expect(helpers.calculatePosition()).resolves.toBe(7);
    expect(interaction.reply.mock.calls[0][0].files[0].name).toBe('wuwster_stats.png');
  });

  it('says so when the player is not registered', async () => {
    mockFindOne.mockResolvedValue(null);
    const interaction = slash({ user: { id: 'other' } });
    await stats(interaction);
    expect(replyText(interaction)).toContain("<@other> isn't registered");
    expect(mockDraw).not.toHaveBeenCalled();
  });
});

describe('rank info for the card', () => {
  const guild: any = {
    roles: {
      cache: new Map([
        ['iron', { name: 'Iron', color: 0xc8d2d7, hexColor: '#c8d2d7', iconURL: () => null }],
        ['gold', { name: 'Gold', color: 0xffd700, hexColor: '#ffd700', iconURL: () => 'https://cdn/gold.png' }],
      ]),
    },
  };

  it('names the current and next rank after their roles', async () => {
    mockRanks.mockResolvedValue([{ roleId: 'iron', startElo: 0, endElo: 999 }, { roleId: 'gold', startElo: 1000, endElo: 1999 }]);
    await expect(getRankInfo(500, guild)).resolves.toMatchObject({
      name: 'Iron', color: '#c8d2d7', startElo: 0, endElo: 999, isMaxRank: false, nextRankName: 'Gold', nextRankStartElo: 1000,
    });
    await expect(getRankInfo(5000, guild)).resolves.toMatchObject({ name: 'Gold', isMaxRank: true, iconUrl: 'https://cdn/gold.png' });
  });

  it('shows Unranked when no ranks are set up', async () => {
    await expect(getRankInfo(100, guild)).resolves.toMatchObject({ name: 'Unranked', isMaxRank: true });
  });
});
