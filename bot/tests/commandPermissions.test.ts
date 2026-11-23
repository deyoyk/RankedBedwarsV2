import fs from 'fs';
import path from 'path';

const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn().mockResolvedValue({});
jest.mock('../src/models/CommandPermissions', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => ({ lean: () => mockFindOne(...args) }),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  },
}));

import { categoryOf, commandsIn } from '../src/config/commandCategories';
import { PermissionService } from '../src/services/PermissionService';
import { categoryView, handlePanelClick, overviewView, rbwconfig, rootView } from '../src/commands/general/rbwconfig';

const registeredCommands = () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/managers/CommandManager.ts'), 'utf8');
  return [...source.matchAll(/this\.reg\('([a-z]+)'/g)].map(match => match[1]);
};

describe('command categories', () => {
  it('puts every registered command in exactly one category', () => {
    const all = [...commandsIn('admin'), ...commandsIn('staff'), ...commandsIn('player')];
    expect(new Set(all).size).toBe(all.length);
    for (const name of registeredCommands()) {
      expect(all).toContain(name);
    }
  });

  it('treats an unknown command as Admin', () => {
    expect(categoryOf('somethingnew')).toBe('admin');
    expect(categoryOf('ban')).toBe('staff');
    expect(categoryOf('party')).toBe('player');
  });
});

describe('PermissionService', () => {
  beforeEach(async () => {
    mockFindOne.mockResolvedValue({ admin: ['A'], staff: ['S'], player: ['P'], playerEveryone: false });
    mockUpdateOne.mockClear();
    await PermissionService.load('guild-1');
  });

  it('stacks categories: Admin roles pass Staff and Player, Staff roles pass Player', () => {
    expect(PermissionService.rolesFor('wipeeveryone')).toEqual(['A']);
    expect(PermissionService.rolesFor('ban').sort()).toEqual(['A', 'S']);
    expect(PermissionService.rolesFor('party').sort()).toEqual(['A', 'P', 'S']);
  });

  it('opens Player commands to everyone when that is on', async () => {
    await PermissionService.update({ playerEveryone: true });
    expect(PermissionService.rolesFor('party')).toEqual(['everyone']);
    expect(PermissionService.rolesFor('ban').sort()).toEqual(['A', 'S']);
  });

  it('saves a change for this server and keeps it in memory', async () => {
    await PermissionService.update({ staff: ['S2'] });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { guildId: 'guild-1' },
      { $set: { admin: ['A'], staff: ['S2'], player: ['P'], playerEveryone: false } },
      { upsert: true },
    );
    expect(PermissionService.rolesFor('ban').sort()).toEqual(['A', 'S2']);
  });

  it('starts a new server with Player open to everyone and the rest for administrators only', async () => {
    mockFindOne.mockResolvedValue(null);
    await PermissionService.load('guild-2');
    expect(PermissionService.rolesFor('party')).toEqual(['everyone']);
    expect(PermissionService.rolesFor('ban')).toEqual([]);
    expect(PermissionService.rolesFor('addqueue')).toEqual([]);
  });
});

describe('/rbwconfig panel', () => {
  const json = (view: { embeds: any[]; components: any[] }) => ({
    embed: view.embeds[0].toJSON(),
    components: view.components.map(row => row.toJSON().components),
  });

  beforeEach(async () => {
    mockFindOne.mockResolvedValue({ admin: [], staff: ['S'], player: [], playerEveryone: true });
    await PermissionService.load('guild-1');
  });

  it('opens on a section menu with the three categories and the overview', () => {
    const { components } = json(rootView());
    expect(components[0][0].options.map((o: any) => o.value)).toEqual(['admin', 'staff', 'player', 'overview']);
  });

  it('shows a category with its roles and commands, and a role picker', () => {
    const { embed, components } = json(categoryView('staff'));
    expect(embed.description).toContain('<@&S>');
    expect(embed.description).toContain('Admin roles can use these too');
    expect(embed.fields[0].value).toContain('`/ban`');
    expect(components[0][0].custom_id).toBe('rbwcfg:roles:staff');
    expect(components[0][0].default_values).toEqual([{ id: 'S', type: 'role' }]);
  });

  it('only shows the Everyone switch on Player', () => {
    const labels = (view: any) => json(view).components[1].map((c: any) => c.label);
    expect(labels(categoryView('player'))).toEqual(['Everyone: on', 'Back']);
    expect(labels(categoryView('admin'))).toEqual(['Back']);
  });

  it('saves picked roles and confirms them in a small note', async () => {
    const click: any = {
      customId: 'rbwcfg:roles:admin', values: ['R1', 'R2'],
      isStringSelectMenu: () => false, isRoleSelectMenu: () => true,
    };
    const view = json(await handlePanelClick(click));
    expect(PermissionService.rolesFor('addqueue')).toEqual(['R1', 'R2']);
    expect(view.embed.description).toContain('-# Admin → <@&R1>, <@&R2>');
  });

  it('turns Everyone off for Player commands', async () => {
    const click: any = { customId: 'rbwcfg:everyone', isStringSelectMenu: () => false, isRoleSelectMenu: () => false };
    await handlePanelClick(click);
    expect(PermissionService.rolesFor('party')).toEqual(['S']);
  });

  it('lists every category in the overview', () => {
    const { embed } = json(overviewView());
    expect(embed.fields.map((f: any) => f.name)).toEqual(['Admin (18)', 'Staff (12)', 'Player (25)']);
    expect(embed.fields[2].value).toContain('Everyone');
  });

  it('turns away anyone who is not a server administrator', async () => {
    const interaction: any = { memberPermissions: { has: () => false }, reply: jest.fn().mockResolvedValue({}) };
    await rbwconfig(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
  });
});
