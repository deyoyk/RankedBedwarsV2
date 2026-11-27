jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: { bot_stats_text: 'Test Server', serverName: 'Test Server' },
}));
jest.mock('../src/utils/releaseVersion', () => ({
  getReleaseVersion: jest.fn().mockResolvedValue('v41'),
}));

import { handleHelpMenu, help } from '../src/commands/help';
import { categoryOf } from '../src/config/commandCategories';
import { PermissionService } from '../src/services/PermissionService';

function member(options: { admin?: boolean; roles?: string[] } = {}) {
  return {
    permissions: { has: () => Boolean(options.admin) },
    roles: { cache: new Map((options.roles ?? []).map((role) => [role, {}])) },
  };
}

function interaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'interaction-help',
    user: { id: '123456789012345678' },
    member: member(),
    guild: { id: 'guild-1' },
    reply: jest.fn().mockResolvedValue({}),
    ...overrides,
  } as any;
}

function categoryValues(target: any): string[] {
  const payload = target.reply.mock.calls.at(-1)[0];
  return payload.components[0].toJSON().components[0].options.map((option: { value: string }) => option.value);
}

afterEach(() => jest.restoreAllMocks());

describe('help command version and server name', () => {
  it('shows the GitHub release version and configured server name', async () => {
    const target = interaction();

    await help(target);

    const payload = target.reply.mock.calls[0][0];
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('-# ➡ Ranked Bedwars System v41');
    expect(embed.description).toContain('Made by <@1526597163885527121> `Deyo` for `Test Server`');
    expect(embed.description).toContain('Select a category to view commands and their required roles.');
    expect(embed.description).not.toContain(':star2:');
    expect(embed.description).not.toContain('2.5.0');
    expect(embed.footer).toBeUndefined();
  });

  it('shows only the categories the member can use', async () => {
    const player = interaction();
    await help(player);
    expect(categoryValues(player)).toEqual(['player']);

    const admin = interaction({ member: member({ admin: true }) });
    await help(admin);
    expect(categoryValues(admin)).toEqual(['admin', 'staff', 'player']);
  });

  it('lists only commands the member can use inside a category', async () => {
    jest.spyOn(PermissionService, 'rolesFor').mockImplementation((command) => {
      const category = categoryOf(command);
      if (category === 'admin') return ['admin-role'];
      if (category === 'staff') return ['staff-role'];
      return ['everyone'];
    });
    const staff = member({ roles: ['staff-role'] });

    const adminView = {
      deferred: true,
      member: staff,
      values: ['admin'],
      deferUpdate: jest.fn(),
      editReply: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
    } as any;
    await handleHelpMenu(adminView);
    const adminEmbed = adminView.editReply.mock.calls[0][0].embeds[0].toJSON();
    expect(adminEmbed.description).not.toContain('`/rbwconfig`');

    const staffView = {
      deferred: true,
      member: staff,
      values: ['staff'],
      deferUpdate: jest.fn(),
      editReply: jest.fn().mockResolvedValue({}),
      update: jest.fn(),
    } as any;
    await handleHelpMenu(staffView);
    const staffEmbed = staffView.editReply.mock.calls[0][0].embeds[0].toJSON();
    expect(staffEmbed.description).toContain('`/score`');
    const categories = staffView.editReply.mock.calls[0][0].components[0].toJSON().components[0].options;
    expect(categories.map((option: { value: string }) => option.value)).toEqual(['staff', 'player']);
  });
});
