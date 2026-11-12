import { PermissionService } from '../src/services/PermissionService';
import { getLevelInfo } from '../src/utils/levelSystem';
import { computePagination, validatePositiveInt } from '../src/managers/validationHelpers';
import { betterEmbed, embedsFor, errorEmbed, successEmbed, themedEmbed, EMBED_THEME } from '../src/utils/betterembed';
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
  it('keeps reds and ambers, turns everything else into the brand teal', () => {
    expect(betterEmbed('t', '#ff0000').builder.toJSON().color).toBe(0xff0000);
    expect(betterEmbed('t', '#ff9900').builder.toJSON().color).toBe(0xff9900);
    expect(betterEmbed('t', '#00ff00').builder.toJSON().color).toBe(EMBED_THEME.successColor);
    expect(betterEmbed('t', '#3498db').builder.toJSON().color).toBe(EMBED_THEME.defaultColor);
  });
  it('drops footers that only repeat the brand', () => {
    const json = themedEmbed().setFooter({ text: 'Veltrix Ranked Bedwars' }).toJSON();
    expect(json.footer).toBeUndefined();
    expect(themedEmbed().setFooter({ text: 'Started' }).toJSON().footer?.text).toBe('Started');
  });
  it('opens every embed with the brand author line instead of a title', () => {
    const json = betterEmbed('t').builder.toJSON();
    expect(json.author?.name).toBe(EMBED_THEME.brandName);
    expect(json.color).toBe(EMBED_THEME.defaultColor);
    expect(json.title).toBeUndefined();
    expect(json.footer).toBeUndefined();

    const error = errorEmbed('e', 'Party Error').builder.toJSON();
    expect(error.color).toBe(EMBED_THEME.errorColor);
    expect(error.title).toBeUndefined();
    expect(error.description).toBe('e');
    expect(successEmbed('s', 'Done').builder.toJSON().color).toBe(EMBED_THEME.successColor);
  });
  it('turns titles into a subtitle line and drops generic ones', () => {
    const json = betterEmbed('Done ✅', 'success', '✅ Game Scored').builder.toJSON();
    expect(json.title).toBeUndefined();
    expect(json.description).toBe('-# ➡ Game Scored\nDone ✅');
    expect(betterEmbed('x', 'info', 'Error').builder.toJSON().description).toBe('x');
  });
  it('embedsFor puts the header in the author line', () => {
    const { themedEmbed: partyEmbed } = embedsFor('Party');
    expect(partyEmbed().toJSON().author?.name).toBe(`${EMBED_THEME.brandName} · Party`);
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
  afterEach(() => jest.restoreAllMocks());
  const admin = { has: () => true };

  it('denies and explains when only server administrators may use the command', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue([]);
    const interaction = messageInteraction(null);
    await expect(checkPermission(interaction, 'score')).resolves.toBe(false);
    expect(interaction.reply).toHaveBeenCalled();
  });
  it('allows everyone', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue(['everyone']);
    const interaction = messageInteraction(null);
    await expect(checkPermission(interaction, 'stats')).resolves.toBe(true);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
  it('allows matching role and denies others', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue(['role1']);
    const withRole = messageInteraction({ roles: { cache: { has: (id: string) => id === 'role1' } } });
    const withoutRole = messageInteraction({ roles: { cache: { has: () => false } } });
    await expect(checkPermission(withRole, 'ban')).resolves.toBe(true);
    await expect(checkPermission(withoutRole, 'ban')).resolves.toBe(false);
  });
  it('denies when member is missing', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue(['role1']);
    await expect(checkPermission(messageInteraction(null), 'ban')).resolves.toBe(false);
  });
  it('always lets server administrators through', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue([]);
    const interaction: any = { user: { id: 'u1' }, memberPermissions: admin, member: null, reply: jest.fn() };
    await expect(checkPermission(interaction, 'wipeeveryone')).resolves.toBe(true);
    expect(interaction.reply).not.toHaveBeenCalled();
  });
  it('gives no user a built-in bypass', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockReturnValue([]);
    const interaction = { author: { id: '1526597163885527121' }, member: null, reply: jest.fn().mockResolvedValue({}) } as any;
    await expect(checkPermission(interaction, 'score')).resolves.toBe(false);
  });
});
