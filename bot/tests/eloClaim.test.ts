import { parseEloClaimRoles, validateEloClaimRolesRaw } from '../src/config/config';
import { getEloClaimEligibility, getEloClaimGrant, hasClaimedEloThisSeason } from '../src/utils/eloClaim';

describe('parseEloClaimRoles', () => {
  it('parses roleId:elo pairs', () => {
    expect(parseEloClaimRoles('1341829830924046346:100,1396112212778684606:300')).toEqual({
      '1341829830924046346': 100,
      '1396112212778684606': 300,
    });
  });

  it('skips invalid entries and takes the last duplicate', () => {
    expect(parseEloClaimRoles('bad,1341829830924046346:0,1341829830924046346:100,1341829830924046346:150,nope:xyz')).toEqual({
      '1341829830924046346': 150,
    });
  });

  it('handles missing and empty input', () => {
    expect(parseEloClaimRoles(undefined)).toEqual({});
    expect(parseEloClaimRoles('')).toEqual({});
    expect(parseEloClaimRoles('   ')).toEqual({});
  });

  it('trims spaces', () => {
    expect(parseEloClaimRoles(' 1341829830924046346 : 200 ')).toEqual({ '1341829830924046346': 200 });
  });
});

describe('validateEloClaimRolesRaw', () => {
  it('accepts valid config', () => {
    expect(validateEloClaimRolesRaw('1341829830924046346:100')).toEqual([]);
    expect(validateEloClaimRolesRaw('')).toEqual([]);
    expect(validateEloClaimRolesRaw(undefined)).toEqual([]);
  });

  it('flags bad snowflake and amount', () => {
    expect(validateEloClaimRolesRaw('bad:100').join('|')).toMatch(/snowflake/);
    expect(validateEloClaimRolesRaw('1341829830924046346:0').join('|')).toMatch(/positive/);
    expect(validateEloClaimRolesRaw('justarole').join('|')).toMatch(/roleId:elo/);
  });
});

describe('getEloClaimGrant', () => {
  const roles = { '111111111111111111': 100, '222222222222222222': 300, '333333333333333333': 150 };

  it('returns null without a matching role', () => {
    expect(getEloClaimGrant([], roles)).toBeNull();
    expect(getEloClaimGrant(['999999999999999999'], roles)).toBeNull();
  });

  it('picks the highest matching role', () => {
    expect(getEloClaimGrant(['111111111111111111', '222222222222222222'], roles)).toEqual({
      roleId: '222222222222222222',
      amount: 300,
    });
  });

  it('returns the single matching role', () => {
    expect(getEloClaimGrant(['333333333333333333'], roles)).toEqual({
      roleId: '333333333333333333',
      amount: 150,
    });
  });
});

describe('getEloClaimEligibility', () => {
  const season = { seasonNumber: 2, chapterNumber: 1 };

  it('requires an active season', () => {
    expect(getEloClaimEligibility(0, [], null)).toBe('no-season');
  });

  it('blocks players who already played a game', () => {
    expect(getEloClaimEligibility(1, [], season)).toBe('played');
    expect(getEloClaimEligibility(5, [{ seasonNumber: 2, chapterNumber: 1 }], season)).toBe('played');
  });

  it('allows missing or zero games', () => {
    expect(getEloClaimEligibility(0, [], season)).toBe('eligible');
    expect(getEloClaimEligibility(undefined, [], season)).toBe('eligible');
    expect(getEloClaimEligibility(null, undefined, season)).toBe('eligible');
  });

  it('blocks a second claim in the same season', () => {
    const claims = [{ date: new Date(), seasonNumber: 2, chapterNumber: 1, amount: 100 }];
    expect(getEloClaimEligibility(0, claims, season)).toBe('claimed');
  });

  it('allows a new claim in a new season or chapter', () => {
    const claims = [{ date: new Date(), seasonNumber: 1, chapterNumber: 1, amount: 100 }];
    expect(getEloClaimEligibility(0, claims, season)).toBe('eligible');
    expect(getEloClaimEligibility(0, claims, { seasonNumber: 2, chapterNumber: 2 })).toBe('eligible');
  });
});

describe('hasClaimedEloThisSeason', () => {
  const season = { seasonNumber: 3, chapterNumber: 2 };

  it('matches season and chapter', () => {
    expect(hasClaimedEloThisSeason([{ seasonNumber: 3, chapterNumber: 2 }], season)).toBe(true);
    expect(hasClaimedEloThisSeason([{ seasonNumber: 3, chapterNumber: 1 }], season)).toBe(false);
    expect(hasClaimedEloThisSeason([{ seasonNumber: 2, chapterNumber: 2 }], season)).toBe(false);
  });

  it('handles missing or empty claims', () => {
    expect(hasClaimedEloThisSeason(undefined, season)).toBe(false);
    expect(hasClaimedEloThisSeason(null, season)).toBe(false);
    expect(hasClaimedEloThisSeason([], season)).toBe(false);
    expect(hasClaimedEloThisSeason([{ seasonNumber: 3, chapterNumber: 2 }], null)).toBe(false);
  });
});
