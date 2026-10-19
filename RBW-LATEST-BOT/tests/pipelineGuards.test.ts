import { normalizeTeams } from '../src/Matchmaking/utils';
import { validatePositiveInt, validatePageLimit, computePagination } from '../src/managers/validationHelpers';
import { parseDuration } from '../src/utils/parseDuration';

function assertGameTeams(team1: string[], team2: string[]) {
  const t = normalizeTeams(team1, team2);
  if (t.team1.length === 0 || t.team2.length === 0) throw new Error('Both teams must have at least one player');
  if (t.team1.length !== t.team2.length) throw new Error('Teams must be equal size');
  return t;
}

describe('game team guards', () => {
  it('rejects empty teams', () => {
    expect(() => assertGameTeams([], ['a'])).toThrow('at least one player');
  });
  it('rejects unequal teams', () => {
    expect(() => assertGameTeams(['a', 'b'], ['c'])).toThrow('equal size');
  });
  it('dedupes overlap so unequal is caught', () => {
    expect(() => assertGameTeams(['a', 'b'], ['b', 'c'])).toThrow();
  });
  it('accepts clean equal teams', () => {
    expect(assertGameTeams(['a', 'b'], ['c', 'd'])).toEqual({ team1: ['a', 'b'], team2: ['c', 'd'] });
  });
});

describe('validationHelpers', () => {
  it('validates positive ints', () => {
    expect(validatePositiveInt(3, 'Page')).toBe(3);
    expect(() => validatePositiveInt(0, 'Page')).toThrow();
    expect(() => validatePositiveInt(-1, 'Page')).toThrow();
  });
  it('paginates', () => {
    expect(computePagination(2, 10, 95)).toEqual({ skip: 10, totalPages: 10 });
    expect(validatePageLimit(1, 10)).toEqual({ page: 1, limit: 10 });
  });
});

describe('parseDuration', () => {
  it('parses h/m/d combos', () => {
    expect(parseDuration('10h')).toBe(10 * 3600 * 1000);
    expect(parseDuration('1d')).toBe(24 * 3600 * 1000);
  });
  it('rejects garbage', () => {
    expect(() => parseDuration('nope')).toThrow();
  });
});
