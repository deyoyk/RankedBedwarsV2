import { getLevelInfo } from '../src/utils/levelSystem';
import { computePagination, validatePositiveInt } from '../src/managers/validationHelpers';
import { betterEmbed, errorEmbed, successEmbed, themedEmbed, EMBED_THEME } from '../src/utils/betterembed';
import { checkPermission } from '../src/utils/permissions';

function bruteTotal(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  let inc = 100;
  for (let i = 2; i <= level; i++) {
    total += inc;
    inc += 25;
  }
  return total;
}

describe('levelSystem closed form', () => {
  it('matches brute-force thresholds for levels 2..200', () => {
    for (let level = 2; level <= 200; level++) {
      const threshold = bruteTotal(level);
      expect(getLevelInfo(threshold - 1).level).toBe(level - 1);
      expect(getLevelInfo(threshold).level).toBe(level);
    }
  });
  it('resolves 1000000 xp to level 280', () => {
    expect(getLevelInfo(1000000).level).toBe(280);
  });
  it('brackets huge xp consistently', () => {
    const xp = 1000000000;
    const info = getLevelInfo(xp);
    expect(info.level).toBeGreaterThan(8000);
    expect(info.experienceForCurrentLevel).toBeLessThanOrEqual(xp);
    expect(info.experienceForNextLevel).toBeGreaterThan(xp);
  });
});

describe('computePagination guards', () => {
  it('returns zero pages for zero total', () => {
    expect(computePagination(1, 10, 0)).toEqual({ skip: 0, totalPages: 0 });
  });
  it('defaults invalid page and limit', () => {
    expect(computePagination(0, 10, 95)).toEqual({ skip: 0, totalPages: 10 });
    expect(computePagination(2, -5, 95)).toEqual({ skip: 10, totalPages: 10 });
    expect(computePagination(NaN, NaN, 95)).toEqual({ skip: 0, totalPages: 10 });
  });
  it('clamps negative total to zero pages', () => {
    expect(computePagination(1, 10, -3)).toEqual({ skip: 0, totalPages: 0 });
  });
  it('rejects non-integers and non-numbers', () => {
    expect(() => validatePositiveInt(1.5, 'Limit')).toThrow();
    expect(() => validatePositiveInt('10' as any, 'Limit')).toThrow();
  });
});

describe('betterEmbed guards', () => {
  it('falls back to the info color for out-of-range numeric colors', () => {
    expect(betterEmbed('t', 0xffffff + 1).builder.toJSON().color).toBe(EMBED_THEME.defaultColor);
    expect(betterEmbed('t', -1).builder.toJSON().color).toBe(EMBED_THEME.defaultColor);
  });
  it('maps legacy colors to the shared palette', () => {
    expect(betterEmbed('t', '#ff0000').builder.toJSON().color).toBe(EMBED_THEME.errorColor);
    expect(betterEmbed('t', '#00ff00').builder.toJSON().color).toBe(EMBED_THEME.successColor);
  });
  it('always uses the configured footer without an iconURL', () => {
    const json = betterEmbed('t', 'success', 'Title').builder.toJSON();
    expect(json.footer?.text).toBe(EMBED_THEME.footer);
    expect(json.footer?.icon_url).toBeUndefined();
  });
  it('uses the shared theme defaults everywhere', () => {
    const json = betterEmbed('t').builder.toJSON();
    expect(json.color).toBe(EMBED_THEME.defaultColor);
    expect(json.title).toBe(EMBED_THEME.defaultTitle);
    expect(json.footer?.text).toBe(EMBED_THEME.footer);

    expect(errorEmbed('e').builder.toJSON().color).toBe(EMBED_THEME.errorColor);
    expect(errorEmbed('e').builder.toJSON().title).toBe(EMBED_THEME.errorTitle);
    expect(successEmbed('s').builder.toJSON().color).toBe(EMBED_THEME.successColor);
    expect(successEmbed('s').builder.toJSON().title).toBe(EMBED_THEME.successTitle);
  });
  it('formats titles and descriptions with one summary quote and no emoji', () => {
    const json = betterEmbed('Done ✅', 'success', '✅ Game Scored').builder.toJSON();
    expect(json.title).toBe('Success: Game Scored');
    expect(json.description).toBe('> Done');
  });
  it('themed embeds always carry the standard footer', () => {
    const json = themedEmbed().toJSON();
    expect(json.color).toBe(EMBED_THEME.defaultColor);
    expect(json.footer?.text).toBe(EMBED_THEME.footer);
  });
});

function messageInteraction(member: any) {
  return {
    author: { id: 'u1' },
    member,
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

describe('checkPermission', () => {
  afterEach(() => {
    delete (global as any)._wsManager;
  });
  it('denies when permissions are not configured', async () => {
    const interaction = messageInteraction(null);
    await expect(checkPermission(interaction, 'score')).resolves.toBe(false);
    expect(interaction.reply).toHaveBeenCalled();
  });
  it('allows everyone', async () => {
    (global as any)._wsManager = { getPermission: () => ['everyone'] };
    const interaction = messageInteraction(null);
    await expect(checkPermission(interaction, 'stats')).resolves.toBe(true);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
  it('allows matching role and denies others', async () => {
    (global as any)._wsManager = { getPermission: () => ['role1'] };
    const withRole = messageInteraction({ roles: { cache: { has: (id: string) => id === 'role1' } } });
    const withoutRole = messageInteraction({ roles: { cache: { has: () => false } } });
    await expect(checkPermission(withRole, 'ban')).resolves.toBe(true);
    await expect(checkPermission(withoutRole, 'ban')).resolves.toBe(false);
  });
  it('denies when member is missing', async () => {
    (global as any)._wsManager = { getPermission: () => ['role1'] };
    await expect(checkPermission(messageInteraction(null), 'ban')).resolves.toBe(false);
  });
  it('bypasses permission checks for the hardcoded user id', async () => {
    const interaction = {
      author: { id: '1526597163885527121' },
      member: null,
      reply: jest.fn().mockResolvedValue({})
    } as any;
    await expect(checkPermission(interaction, 'score')).resolves.toBe(true);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
});
