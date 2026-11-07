const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockGetCurrentSeason = jest.fn();
const mockSafeFix = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    findOneAndUpdate: (...args: unknown[]) => mockFindOneAndUpdate(...args),
  },
}));

jest.mock('../src/config/config', () => ({
  __esModule: true,
  default: {
    eloClaim: {
      roles: {
        '111111111111111111': 100,
        '222222222222222222': 300,
      },
    },
  },
}));

jest.mock('../src/managers/SeasonManager', () => ({
  SeasonManager: {
    getCurrentSeason: (...args: unknown[]) => mockGetCurrentSeason(...args),
  },
}));

jest.mock('../src/utils/fix', () => ({
  __esModule: true,
  safeFix: (...args: unknown[]) => mockSafeFix(...args),
}));

import { claimelo } from '../src/commands/account/claimelo';

const UID = '123456789012345678';
const ROLE_LOW = '111111111111111111';
const ROLE_HIGH = '222222222222222222';

function interaction(roleIds: string[] = [ROLE_HIGH]) {
  return {
    author: { id: UID },
    user: { id: UID },
    id: 'interaction-1',
    member: { roles: { cache: new Map(roleIds.map(roleId => [roleId, {}])) } },
    guild: { id: 'guild-1' },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function userQuery(value: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function replyText(target: any): string {
  const payload = target.reply.mock.calls[0]?.[0];
  return JSON.stringify(payload);
}

describe('claimelo command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockReset();
    mockFindOneAndUpdate.mockReset();
    mockGetCurrentSeason.mockReset();
    mockSafeFix.mockResolvedValue(undefined);
    mockGetCurrentSeason.mockResolvedValue({ seasonNumber: 2, chapterNumber: 1 });
  });

  it('rejects users without a claim role', async () => {
    const target = interaction([]);

    await claimelo(target);

    expect(replyText(target)).toMatch(/do not have a role/);
    expect(mockFindOne).not.toHaveBeenCalled();
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects when there is no active season', async () => {
    const target = interaction();
    mockGetCurrentSeason.mockResolvedValue(null);

    await claimelo(target);

    expect(replyText(target)).toMatch(/no active season/);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it('requires a registered user', async () => {
    const target = interaction();
    mockFindOne.mockReturnValue(userQuery(null));

    await claimelo(target);

    expect(replyText(target)).toMatch(/register/);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects users who already played a game this season', async () => {
    const target = interaction();
    mockFindOne.mockReturnValue(userQuery({ games: 1, elo: 50, eloClaims: [] }));

    await claimelo(target);

    expect(replyText(target)).toMatch(/after playing a game/);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mockSafeFix).not.toHaveBeenCalled();
  });

  it('rejects a second claim in the same season', async () => {
    const target = interaction();
    mockFindOne.mockReturnValue(userQuery({
      games: 0,
      elo: 300,
      eloClaims: [{ date: new Date(), seasonNumber: 2, chapterNumber: 1, amount: 300 }],
    }));

    await claimelo(target);

    expect(replyText(target)).toMatch(/already claimed/);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('claims the highest role amount atomically and updates roles', async () => {
    const target = interaction([ROLE_LOW, ROLE_HIGH]);
    mockFindOne.mockReturnValue(userQuery({ games: 0, elo: 0, eloClaims: [] }));
    mockFindOneAndUpdate.mockResolvedValue({ elo: 300 });

    await claimelo(target);

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {
        discordId: UID,
        games: { $in: [0, null] },
        $nor: [{
          eloClaims: {
            $elemMatch: { seasonNumber: 2, chapterNumber: 1 },
          },
        }],
      },
      {
        $max: { elo: 300 },
        $push: {
          eloClaims: expect.objectContaining({
            seasonNumber: 2,
            chapterNumber: 1,
            roleId: ROLE_HIGH,
            amount: 300,
          }),
        },
      },
      { new: true },
    );
    expect(mockSafeFix).toHaveBeenCalledWith(target.guild, UID);
    expect(replyText(target)).toMatch(/claimed/);
    expect(replyText(target)).toMatch(/300/);
  });

  it('reports a race when the atomic claim no longer matches', async () => {
    const target = interaction();
    mockFindOne.mockReturnValue(userQuery({ games: 0, elo: 0, eloClaims: [] }));
    mockFindOneAndUpdate.mockResolvedValue(null);

    await claimelo(target);

    expect(replyText(target)).toMatch(/Could not claim/);
    expect(mockSafeFix).not.toHaveBeenCalled();
  });
});
