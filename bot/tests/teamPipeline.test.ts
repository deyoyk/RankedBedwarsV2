import { normalizeIdList, normalizeTeams, normalizeIgnKey, calculateTeamAverageElo, getPlayerIGNs } from '../src/Matchmaking/utils';

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn() }
}));
import User from '../src/models/User';

describe('normalizeIdList', () => {
  it('trims, dedupes, drops empties', () => {
    expect(normalizeIdList([' a ', 'a', '', 'b', ' b '])).toEqual(['a', 'b']);
  });
});

describe('normalizeTeams', () => {
  it('removes overlap from team2 and dedupes', () => {
    expect(normalizeTeams(['a', 'b', 'a'], ['b', 'c'])).toEqual({ team1: ['a', 'b'], team2: ['c'] });
  });
  it('keeps order and drops blanks', () => {
    expect(normalizeTeams(['', 'x'], ['y', 'y'])).toEqual({ team1: ['x'], team2: ['y'] });
  });
});

describe('normalizeIgnKey', () => {
  it('lowercases and trims', () => {
    expect(normalizeIgnKey('  DeYo123 ')).toBe('deyo123');
  });
});

describe('calculateTeamAverageElo hardened', () => {
  it('divides by fetched users not requested ids', async () => {
    (User.find as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue([{ elo: 1000 }, { elo: 1400 }]) });
    await expect(calculateTeamAverageElo(['a', 'b', 'missing'])).resolves.toBe(1200);
  });
  it('returns 0 when no users found', async () => {
    (User.find as jest.Mock).mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
    await expect(calculateTeamAverageElo(['a'])).resolves.toBe(0);
  });
  it('dedupes ids before query', async () => {
    const select = jest.fn().mockResolvedValue([{ elo: 500 }]);
    (User.find as jest.Mock).mockReturnValue({ select });
    await calculateTeamAverageElo(['a', 'a', ' a ']);
    expect(User.find).toHaveBeenCalledWith({ discordId: { $in: ['a'] } });
  });
});

describe('getPlayerIGNs hardened', () => {
  it('returns empty map for blank input without db hit', async () => {
    (User.find as jest.Mock).mockClear();
    await expect(getPlayerIGNs([' ', ''])).resolves.toEqual(new Map());
    expect(User.find).not.toHaveBeenCalled();
  });
});
