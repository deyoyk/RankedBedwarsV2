const mockUserFindOne = jest.fn();
const mockGameFind = jest.fn();
const mockGameCount = jest.fn();
const mockPaginate = jest.fn();

jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => mockUserFindOne(...args) },
}));

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: {
    find: (...args: unknown[]) => mockGameFind(...args),
    countDocuments: (...args: unknown[]) => mockGameCount(...args),
  },
}));

jest.mock('../src/utils/paginate', () => ({
  __esModule: true,
  paginate: (...args: unknown[]) => mockPaginate(...args),
}));

import { games, gamesFilter } from '../src/commands/general/games';

const UID = '123456789012345678';

function lean(value: unknown) {
  return { select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue(value) };
}

function gameQuery(items: unknown[]) {
  const q = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
  };
  return q;
}

function interaction(user: { id: string; username: string } | null) {
  return { options: { getUser: jest.fn().mockReturnValue(user), getInteger: jest.fn().mockReturnValue(null) } } as any;
}

describe('/games', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGameFind.mockReturnValue(gameQuery([{ gameId: 7, state: 'scored' }]));
    mockGameCount.mockResolvedValue(1);
  });

  it('builds a filter for either team, or none without a player', () => {
    expect(gamesFilter()).toEqual({});
    expect(gamesFilter(UID)).toEqual({ $or: [{ team1: UID }, { team2: UID }] });
  });

  it('lists every game when no user is given', async () => {
    await games(interaction(null));
    const config = mockPaginate.mock.calls[0][1];
    expect(config.title).toBe('Game History');
    await config.fetchPage(0, 15);
    expect(mockGameCount).toHaveBeenCalledWith({});
    expect(mockGameFind).toHaveBeenCalledWith({});
    expect(mockUserFindOne).not.toHaveBeenCalled();
  });

  it("only lists the chosen player's games, named by their linked IGN", async () => {
    mockUserFindOne.mockReturnValue(lean({ ign: 'LoveDeyo' }));
    await games(interaction({ id: UID, username: 'deyo' }));
    const config = mockPaginate.mock.calls[0][1];
    expect(config.title).toBe("LoveDeyo's Game History");
    expect(config.emptyMessage).toBe("LoveDeyo hasn't played any games.");
    const page = await config.fetchPage(0, 15);
    const filter = { $or: [{ team1: UID }, { team2: UID }] };
    expect(mockGameCount).toHaveBeenCalledWith(filter);
    expect(mockGameFind).toHaveBeenCalledWith(filter);
    expect(page.items).toEqual([{ gameId: 7, state: 'scored' }]);
  });

  it('falls back to the Discord name when the player is not linked', async () => {
    mockUserFindOne.mockReturnValue(lean(null));
    await games(interaction({ id: UID, username: 'deyo' }));
    expect(mockPaginate.mock.calls[0][1].title).toBe("deyo's Game History");
  });
});
