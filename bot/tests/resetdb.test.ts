jest.mock('../src/config/config', () => ({ __esModule: true, default: { roles: { banned: 'r-banned', muted: 'r-muted' } } }));
jest.mock('../src/models/EloRank', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../src/utils/safeReply', () => ({ safeReply: jest.fn() }));

import { clearEveryone, clearMember, resetdb, rolesToClear } from '../src/commands/account/resetdb';

const EloRank = require('../src/models/EloRank').default;
const { safeReply } = require('../src/utils/safeReply');

const member = (roles: string[]) => {
  const held = new Set(roles);
  return { roles: { cache: { has: (id: string) => held.has(id) }, remove: jest.fn(async (ids: string[]) => ids.forEach(id => held.delete(id))) }, held } as any;
};

beforeEach(() => {
  EloRank.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ roleId: 'r-coal' }, { roleId: 'r-iron' }]) }) });
});

describe('/resetdb', () => {
  test('clears the ELO rank roles plus the muted and banned roles', async () => {
    expect(await rolesToClear()).toEqual(['r-coal', 'r-iron', 'r-banned', 'r-muted']);
  });

  test('one member only loses the roles they have, and other roles stay', async () => {
    const m = member(['r-iron', 'r-muted', 'r-staff']);
    expect(await clearMember(m, ['r-coal', 'r-iron', 'r-banned', 'r-muted'])).toBe(2);
    expect(m.roles.remove).toHaveBeenCalledWith(['r-iron', 'r-muted'], expect.any(String));
    expect([...m.held]).toEqual(['r-staff']);
    const clean = member(['r-staff']);
    expect(await clearMember(clean, ['r-coal'])).toBe(0);
    expect(clean.roles.remove).not.toHaveBeenCalled();
  });

  test('globally goes through every member and counts what could not be changed', async () => {
    const stuck = member(['r-banned']);
    stuck.roles.remove.mockRejectedValue(new Error('Missing Permissions'));
    const members = new Map([['1', member(['r-coal'])], ['2', member([])], ['3', stuck], ['4', member(['r-iron', 'r-banned'])]]);
    const totals = await clearEveryone({ members: { fetch: async () => members } } as any, ['r-coal', 'r-iron', 'r-banned']);
    expect(totals).toEqual({ members: 2, roles: 3, failed: 1 });
  });

  test('needs exactly one of user or global', async () => {
    const run = (user: unknown, global: boolean) => resetdb({
      guild: {}, options: { getUser: () => user, getBoolean: () => global },
    } as any);
    await run(null, false);
    await run({ id: '5' }, true);
    expect(safeReply).toHaveBeenCalledTimes(2);
    for (const call of safeReply.mock.calls) {
      expect(call[1].builder.toJSON().description).toContain('either');
    }
  });
});
