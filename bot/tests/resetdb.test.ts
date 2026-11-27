jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: { roles: { banned: 'r-banned', muted: 'r-muted', registered: 'r-reg', nonRegistered: 'r-unreg' } },
}));
jest.mock('../src/models/EloRank', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../src/models/User', () => ({ __esModule: true, default: { deleteOne: jest.fn(), deleteMany: jest.fn() } }));
jest.mock('../src/models/PunishmentAction', () => ({ __esModule: true, default: { deleteMany: jest.fn() } }));
jest.mock('../src/utils/safeReply', () => ({ safeReply: jest.fn() }));

import { clearEveryone, clearMember, resetdb, rolesToClear, warningText, wipeData } from '../src/commands/account/resetdb';

const EloRank = require('../src/models/EloRank').default;
const User = require('../src/models/User').default;
const PunishmentAction = require('../src/models/PunishmentAction').default;
const { safeReply } = require('../src/utils/safeReply');

const ROLES = ['r-coal', 'r-iron', 'r-reg', 'r-banned', 'r-muted'];

const member = (roles: string[]) => {
  const held = new Set(roles);
  return {
    held,
    roles: {
      cache: { has: (id: string) => held.has(id) },
      remove: jest.fn(async (ids: string[]) => ids.forEach(id => held.delete(id))),
      add: jest.fn(async (id: string) => { held.add(id); }),
    },
  } as any;
};

function command(target: string | null, global: boolean, m: any, click: { customId: string } | null) {
  const update = jest.fn();
  safeReply.mockResolvedValueOnce({
    awaitMessageComponent: () => (click ? Promise.resolve({ ...click, update }) : Promise.reject(new Error('time'))),
  });
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    guild: { members: { fetch: async (id?: string) => (id ? m : new Map([['1', m]])) } },
    options: { getUser: () => (target ? { id: target } : null), getBoolean: () => global },
    editReply,
  } as any;
  return { run: () => resetdb(interaction), editReply };
}

const lastText = (editReply: jest.Mock) => editReply.mock.calls.at(-1)[0].embeds[0].toJSON().description as string;

beforeEach(() => {
  safeReply.mockReset();
  EloRank.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ roleId: 'r-coal' }, { roleId: 'r-iron' }]) }) });
  User.deleteOne.mockResolvedValue({ deletedCount: 1 });
  User.deleteMany.mockResolvedValue({ deletedCount: 40 });
  PunishmentAction.deleteMany.mockResolvedValue({});
});

describe('/resetdb', () => {
  test('takes off the ELO rank, registered, banned and muted roles', async () => {
    expect(await rolesToClear()).toEqual(ROLES);
  });

  test('a wiped member gets the not-registered role, and keeps their other roles', async () => {
    const m = member(['r-iron', 'r-reg', 'r-muted', 'r-staff']);
    expect(await clearMember(m, ROLES, 'r-unreg')).toBe(3);
    expect([...m.held].sort()).toEqual(['r-staff', 'r-unreg']);
    const clean = member(['r-staff']);
    expect(await clearMember(clean, ROLES, 'r-unreg')).toBe(0);
    expect(clean.roles.add).not.toHaveBeenCalled();
  });

  test('deletes the account and its punishment records, for one player or everyone', async () => {
    expect(await wipeData('5')).toBe(1);
    expect(User.deleteOne).toHaveBeenCalledWith({ discordId: '5' });
    expect(PunishmentAction.deleteMany).toHaveBeenCalledWith({ targetId: '5' });
    expect(await wipeData(null)).toBe(40);
    expect(User.deleteMany).toHaveBeenCalledWith({});
    expect(PunishmentAction.deleteMany).toHaveBeenLastCalledWith({});
  });

  test('globally goes through every member and counts what could not be changed', async () => {
    const stuck = member(['r-banned']);
    stuck.roles.remove.mockRejectedValue(new Error('Missing Permissions'));
    const members = new Map([['1', member(['r-coal'])], ['2', member([])], ['3', stuck], ['4', member(['r-iron', 'r-reg'])]]);
    const totals = await clearEveryone({ members: { fetch: async () => members } } as any, ROLES);
    expect(totals).toEqual({ members: 2, roles: 3, failed: 1 });
  });

  test('warns that it deletes the whole account and cannot be undone', () => {
    expect(warningText('5')).toContain("<@5>'s ranked account");
    expect(warningText('5')).toContain('ELO, IGN, stats and every ban, mute and strike');
    expect(warningText(null)).toContain("**every player's**");
    expect(warningText('5')).toContain("can't be undone");
    expect(warningText('5')).toContain('/link');
  });

  test('needs exactly one of user or global', async () => {
    for (const [user, global] of [[null, false], ['5', true]] as const) {
      await resetdb({ guild: {}, options: { getUser: () => (user ? { id: user } : null), getBoolean: () => global } } as any);
    }
    expect(safeReply).toHaveBeenCalledTimes(2);
    for (const call of safeReply.mock.calls) {
      expect(call[1].builder.toJSON().description).toContain('either');
    }
  });

  test('wipes nothing when the warning is cancelled or left', async () => {
    for (const click of [{ customId: 'resetdb:cancel' }, null]) {
      const m = member(['r-reg']);
      const { run, editReply } = command('5', false, m, click);
      await run();
      expect(User.deleteOne).not.toHaveBeenCalled();
      expect(m.roles.remove).not.toHaveBeenCalled();
      expect(lastText(editReply)).toBe('Nothing was wiped.');
    }
  });

  test('wipes the player once the warning is confirmed', async () => {
    const m = member(['r-coal', 'r-reg']);
    const { run, editReply } = command('5', false, m, { customId: 'resetdb:confirm' });
    await run();
    expect(User.deleteOne).toHaveBeenCalledWith({ discordId: '5' });
    expect([...m.held]).toEqual(['r-unreg']);
    expect(lastText(editReply)).toContain("Deleted <@5>'s ranked account");
  });

  test('wipes everyone once the global warning is confirmed', async () => {
    const m = member(['r-iron']);
    const { run, editReply } = command(null, true, m, { customId: 'resetdb:confirm' });
    await run();
    expect(User.deleteMany).toHaveBeenCalledWith({});
    expect(lastText(editReply)).toContain('Deleted 40 ranked accounts');
  });
});
