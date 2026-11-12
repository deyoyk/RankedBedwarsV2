const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn().mockResolvedValue({});
const mockFindOneAndUpdate = jest.fn();
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
    countDocuments: jest.fn().mockResolvedValue(6),
  },
}));
const mockRanks = jest.fn();
jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: { find: () => ({ select: () => ({ sort: () => ({ lean: () => mockRanks() }) }) }) },
}));
const mockDraw = jest.fn();
jest.mock('../src/themes', () => ({
  themes: ['veltrix', 'halloween', 'gojo'],
  resolveTheme: (name: string) => (...args: unknown[]) => mockDraw(name, ...args),
}));

import { recentResults, stats, themeFor } from '../src/commands/stats/stats';
import { changetheme, thememanage, themesCommand } from '../src/commands/stats/themes';
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
  it('uses the chosen theme only if the player owns it', () => {
    expect(themeFor({ currentTheme: 'gojo', ownedThemes: ['gojo'] } as any)).toBe('gojo');
    expect(themeFor({ currentTheme: 'gojo', ownedThemes: [] } as any)).toBe('veltrix');
    expect(themeFor({ currentTheme: 'elite' } as any)).toBe('veltrix');
  });

  it('lists the newest ten games with their results', () => {
    const games = Array.from({ length: 12 }, (_, i) => ({ gameId: i, date: new Date(i * 1000), state: i % 3 === 0 ? 'voided' : 'scored', won: i % 2 === 0 }));
    const recent = recentResults({ recentGames: games } as any);
    expect(recent).toHaveLength(10);
    expect(recent[0]).toEqual({ gameid: 11, result: 'lose' });
    expect(recent[1]).toEqual({ gameid: 10, result: 'win' });
    expect(recent[2]).toEqual({ gameid: 9, result: 'voided' });
  });

  it('sends the card as an image for a registered player', async () => {
    mockFindOne.mockResolvedValue({ discordId: 'me', ign: 'wuwster', elo: 1234, wins: 4, winStreak: 2, currentTheme: 'veltrix', recentGames: [] });
    const interaction = slash();
    await stats(interaction);

    const [theme, playerData, , helpers] = mockDraw.mock.calls[0];
    expect(theme).toBe('veltrix');
    expect(playerData).toMatchObject({ ign: 'wuwster', elo: 1234, wins: 4, winstreak: 2 });
    await expect(helpers.calculatePosition()).resolves.toBe(7);
    expect(interaction.reply.mock.calls[0][0].files[0].name).toBe('wuwster_stats.png');
  });

  it('falls back to the default theme when a theme fails to draw', async () => {
    mockFindOne.mockResolvedValue({ discordId: 'me', ign: 'p', currentTheme: 'gojo', ownedThemes: ['gojo'], recentGames: [] });
    mockDraw.mockRejectedValueOnce(new Error('broken background'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const interaction = slash();
    await stats(interaction);
    warn.mockRestore();
    expect(mockDraw.mock.calls.map(call => call[0])).toEqual(['gojo', 'veltrix']);
    expect(interaction.reply.mock.calls[0][0].files).toHaveLength(1);
  });

  it('says so when the player is not registered', async () => {
    mockFindOne.mockResolvedValue(null);
    const interaction = slash({ user: { id: 'other' } });
    await stats(interaction);
    expect(replyText(interaction)).toContain("<@other> isn't registered");
    expect(mockDraw).not.toHaveBeenCalled();
  });
});

describe('theme commands', () => {
  it('lists owned themes and the current one', async () => {
    mockFindOne.mockResolvedValue({ discordId: 'me', currentTheme: 'gojo', ownedThemes: ['gojo'] });
    const interaction = slash();
    await themesCommand(interaction);
    expect(replyText(interaction)).toContain('`veltrix` `gojo`');
    expect(interaction.reply.mock.calls[0][0].flags).toBe(64);
  });

  it('only switches to a theme the player owns', async () => {
    mockFindOne.mockResolvedValue({ discordId: 'me', ownedThemes: [] });
    const denied = slash({ theme: 'gojo' });
    await changetheme(denied);
    expect(replyText(denied)).toContain("don't own the `gojo` theme");
    expect(mockUpdateOne).not.toHaveBeenCalled();

    mockFindOne.mockResolvedValue({ discordId: 'me', ownedThemes: ['gojo'] });
    await changetheme(slash({ theme: 'gojo' }));
    expect(mockUpdateOne).toHaveBeenCalledWith({ discordId: 'me' }, { $set: { currentTheme: 'gojo' } });
  });

  it('gives and takes themes, resetting a taken theme that was in use', async () => {
    mockFindOneAndUpdate.mockResolvedValue({ discordId: 't', currentTheme: 'halloween' });
    await thememanage(slash({ action: 'give', user: { id: 't' }, theme: 'halloween' }));
    expect(mockFindOneAndUpdate).toHaveBeenLastCalledWith({ discordId: 't' }, { $addToSet: { ownedThemes: 'halloween' } }, { new: true });
    expect(mockUpdateOne).not.toHaveBeenCalled();

    await thememanage(slash({ action: 'take', user: { id: 't' }, theme: 'halloween' }));
    expect(mockFindOneAndUpdate).toHaveBeenLastCalledWith({ discordId: 't' }, { $pull: { ownedThemes: 'halloween' } }, { new: true });
    expect(mockUpdateOne).toHaveBeenCalledWith({ discordId: 't' }, { $set: { currentTheme: 'veltrix' } });
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
