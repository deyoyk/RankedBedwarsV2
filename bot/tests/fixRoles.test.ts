const mockUpdateMemberRoles = jest.fn();
const mockSetMemberNickname = jest.fn();
const mockFindOne = jest.fn();

jest.mock('../src/managers/WorkersManager', () => ({
  WorkersManager: {
    getInstance: () => ({
      updateMemberRoles: (...args: unknown[]) => mockUpdateMemberRoles(...args),
      setMemberNickname: (...args: unknown[]) => mockSetMemberNickname(...args),
    }),
  },
}));

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
  },
}));

jest.mock('../src/models/EloRank', () => ({
  __esModule: true,
  default: {
    find: () => Promise.resolve([
      { roleId: 'rank-stale', startElo: 0, endElo: 100 },
      { roleId: 'old-rank-role', startElo: 101, endElo: 200 },
    ]),
  },
}));

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    roles: {
      registered: 'registered-role',
      nonRegistered: 'non-registered-role',
    },
  },
}));

import { fix } from '../src/utils/fix';

const UID = '123456789012345678';

function userQuery(value: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function setup() {
  const member: any = {
    nickname: 'old nickname',
    roles: {
      cache: new Map([
        ['non-registered-role', {}],
        ['old-rank-role', {}],
      ]),
    },
  };
  const guild: any = {
    members: {
      cache: { get: () => member },
      fetch: jest.fn(),
    },
    roles: {
      cache: new Map([
        ['registered-role', {}],
        ['non-registered-role', {}],
        ['old-rank-role', {}],
      ]),
    },
  };
  return { guild, member };
}

describe('fix role updates', () => {
  beforeEach(() => {
    mockUpdateMemberRoles.mockReset();
    mockSetMemberNickname.mockReset();
    mockFindOne.mockReset();
    mockUpdateMemberRoles.mockResolvedValue(undefined);
    mockSetMemberNickname.mockResolvedValue(undefined);
    mockFindOne.mockReturnValue(userQuery({
      discordId: UID,
      elo: 50,
      ign: 'Steve',
      settings: {},
    }));
  });

  it('skips roles that no longer exist in the guild', async () => {
    const { guild } = setup();

    await fix(guild, UID);

    expect(mockUpdateMemberRoles).toHaveBeenCalledWith(
      UID,
      ['registered-role'],
      ['non-registered-role', 'old-rank-role'],
      6,
    );
  });

  it('does not send a role update when every requested role is gone', async () => {
    const { guild } = setup();
    guild.roles.cache = new Map();
    mockFindOne.mockReturnValue(userQuery(null));

    await fix(guild, UID);

    expect(mockUpdateMemberRoles).not.toHaveBeenCalled();
  });
});
