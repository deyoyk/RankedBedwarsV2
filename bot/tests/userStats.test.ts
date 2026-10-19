import { escapeRegex } from '../src/utils/regexEscape';
import { updateDailyElo, computeWlr, ensureUserStats } from '../src/utils/userStats';

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    const escaped = escapeRegex('a.b[c](d)e*f+g?h^i$j{k|l}m\\n');
    const re = new RegExp(`^${escaped}$`);
    expect(re.test('a.b[c](d)e*f+g?h^i$j{k|l}m\\n')).toBe(true);
    expect(re.test('axbxc')).toBe(false);
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeRegex('Steve123')).toBe('Steve123');
  });
});

describe('updateDailyElo', () => {
  it('creates a new entry for today when none exists', () => {
    const user: any = { dailyElo: [] };
    updateDailyElo(user, 1200);
    expect(user.dailyElo).toHaveLength(1);
    expect(user.dailyElo[0].elo).toBe(1200);
  });

  it('updates the existing entry for today', () => {
    const user: any = { dailyElo: [{ elo: 1100, date: new Date() }] };
    updateDailyElo(user, 1300);
    expect(user.dailyElo).toHaveLength(1);
    expect(user.dailyElo[0].elo).toBe(1300);
  });

  it('does not merge entries from other days', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const user: any = { dailyElo: [{ elo: 1000, date: yesterday }] };
    updateDailyElo(user, 1200);
    expect(user.dailyElo).toHaveLength(2);
  });
});

describe('computeWlr', () => {
  it('computes wins/losses ratio', () => {
    expect(computeWlr(10, 5)).toBe(2);
    expect(computeWlr(3, 2)).toBe(1.5);
  });

  it('returns wins when no losses', () => {
    expect(computeWlr(7, 0)).toBe(7);
  });

  it('returns 0 with no wins', () => {
    expect(computeWlr(0, 4)).toBe(0);
  });
});

describe('ensureUserStats', () => {
  it('normalizes missing numeric stats to 0', () => {
    const user: any = { elo: undefined, wins: NaN, losses: 5 };
    ensureUserStats(user);
    expect(user.elo).toBe(0);
    expect(user.wins).toBe(0);
    expect(user.losses).toBe(5);
    expect(user.games).toBe(0);
    expect(Array.isArray(user.dailyElo)).toBe(true);
  });
});
