import { getStatResetAllowance, countStatResetsInWindow } from '../src/utils/statReset';
import { parseStatResetRoles, parseStatResetScope, validateStatResetRolesRaw } from '../src/config/config';

describe('parseStatResetRoles', () => {
  it('parses roleId:count pairs', () => {
    expect(parseStatResetRoles('1332222222333333333:2,1444444444555555555:4')).toEqual({
      '1332222222333333333': 2,
      '1444444444555555555': 4,
    });
  });

  it('skips invalid entries', () => {
    expect(parseStatResetRoles('bad,123:2,1332222222333333333:0,1332222222333333333:2, ,nope:xyz')).toEqual({
      '1332222222333333333': 2,
    });
  });

  it('handles missing and empty input', () => {
    expect(parseStatResetRoles(undefined)).toEqual({});
    expect(parseStatResetRoles('')).toEqual({});
    expect(parseStatResetRoles('   ')).toEqual({});
  });

  it('trims spaces', () => {
    expect(parseStatResetRoles(' 1332222222333333333 : 3 ')).toEqual({ '1332222222333333333': 3 });
  });
});

describe('parseStatResetScope', () => {
  it('recognises days, defaults to season', () => {
    expect(parseStatResetScope('days')).toBe('days');
    expect(parseStatResetScope('DAYS')).toBe('days');
    expect(parseStatResetScope('season')).toBe('season');
    expect(parseStatResetScope('')).toBe('season');
    expect(parseStatResetScope(undefined)).toBe('season');
    expect(parseStatResetScope('bogus')).toBe('season');
  });
});

describe('validateStatResetRolesRaw', () => {
  it('accepts valid config', () => {
    expect(validateStatResetRolesRaw('1332222222333333333:2')).toEqual([]);
    expect(validateStatResetRolesRaw('')).toEqual([]);
    expect(validateStatResetRolesRaw(undefined)).toEqual([]);
  });

  it('flags bad snowflake and count', () => {
    expect(validateStatResetRolesRaw('bad:2').join('|')).toMatch(/snowflake/);
    expect(validateStatResetRolesRaw('1332222222333333333:0').join('|')).toMatch(/positive/);
    expect(validateStatResetRolesRaw('justarole').join('|')).toMatch(/roleId:resets/);
  });
});

describe('getStatResetAllowance', () => {
  const roles = { '111111111111111111': 2, '222222222222222222': 4, '333333333333333333': 1 };

  it('returns 0 without a matching role', () => {
    expect(getStatResetAllowance([], roles)).toBe(0);
    expect(getStatResetAllowance(['999999999999999999'], roles)).toBe(0);
  });

  it('picks the highest matching role', () => {
    expect(getStatResetAllowance(['111111111111111111', '222222222222222222'], roles)).toBe(4);
    expect(getStatResetAllowance(['222222222222222222', '111111111111111111'], roles)).toBe(4);
  });

  it('returns the single matching count', () => {
    expect(getStatResetAllowance(['111111111111111111'], roles)).toBe(2);
  });
});

describe('countStatResetsInWindow', () => {
  const now = new Date('2026-11-07T12:00:00Z');

  it('counts season resets by active season and chapter', () => {
    const resets = [
      { date: new Date('2026-11-01'), seasonNumber: 2, chapterNumber: 1 },
      { date: new Date('2026-11-05'), seasonNumber: 2, chapterNumber: 1 },
      { date: new Date('2026-10-01'), seasonNumber: 1, chapterNumber: 1 },
      { date: new Date('2026-11-02'), seasonNumber: 2, chapterNumber: 2 },
    ];
    expect(countStatResetsInWindow(resets, 'season', 30, { seasonNumber: 2, chapterNumber: 1 }, now)).toBe(2);
  });

  it('returns 0 for season scope with no active season', () => {
    const resets = [{ date: new Date('2026-11-01'), seasonNumber: 2, chapterNumber: 1 }];
    expect(countStatResetsInWindow(resets, 'season', 30, null, now)).toBe(0);
  });

  it('counts days scope within rolling window', () => {
    const resets = [
      { date: new Date('2026-11-07T11:00:00Z') },
      { date: new Date('2026-10-09T11:00:00Z') },
      { date: new Date('2026-10-08T11:00:00Z') },
    ];
    expect(countStatResetsInWindow(resets, 'days', 30, null, now)).toBe(2);
  });

  it('handles empty and missing resets', () => {
    expect(countStatResetsInWindow([], 'days', 30, null, now)).toBe(0);
    expect(countStatResetsInWindow(undefined, 'days', 30, null, now)).toBe(0);
    expect(countStatResetsInWindow(null, 'season', 30, { seasonNumber: 1, chapterNumber: 1 }, now)).toBe(0);
  });

  it('counts string dates and ignores invalid dates', () => {
    const resets: any[] = [
      { date: '2026-11-07T10:00:00Z', seasonNumber: 1, chapterNumber: 1 },
      { date: 'not-a-date', seasonNumber: 1, chapterNumber: 1 },
    ];
    expect(countStatResetsInWindow(resets, 'days', 30, null, now)).toBe(1);
    expect(countStatResetsInWindow(resets, 'season', 30, { seasonNumber: 1, chapterNumber: 1 }, now)).toBe(2);
  });
});
