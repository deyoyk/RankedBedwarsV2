const mockValidatePartyAccess = jest.fn();
const mockGetSharedInstance = jest.fn();
const mockEvaluatePresence = jest.fn();

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../src/services/PartyService', () => ({
  __esModule: true,
  PartyService: { validatePartyAccess: (...args: unknown[]) => mockValidatePartyAccess(...args) },
}));
jest.mock('../src/managers/MapManager', () => ({
  __esModule: true,
  MapService: { getSharedInstance: (...args: unknown[]) => mockGetSharedInstance(...args) },
}));
jest.mock('../src/services/PresenceService', () => ({
  __esModule: true,
  PresenceService: { evaluate: (...args: unknown[]) => mockEvaluatePresence(...args) },
}));
jest.mock('../src/Matchmaking/utils', () => ({
  __esModule: true,
  claimMapPick: jest.fn(),
  getRecentMapPicks: jest.fn(() => new Set()),
}));

import Game from '../src/models/Game';
import User from '../src/models/User';
import { PrivateGameService } from '../src/services/PrivateGameService';
import { queuePlayers } from '../src/types/queuePlayersMemory';
import { claimPlayers, clearAllDraftClaims } from '../src/Matchmaking/draftClaims';

const GameModel = Game as unknown as { findOne: jest.Mock };
const UserModel = User as unknown as { find: jest.Mock };
const validatePartyAccess = mockValidatePartyAccess;
const getSharedInstance = mockGetSharedInstance;
const evaluatePresence = mockEvaluatePresence;

function chain(value: any) {
  return {
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }),
    lean: jest.fn().mockResolvedValue(value),
  };
}

function party(members: string[], maxMembers = 8) {
  return {
    isValid: true,
    party: {
      partyId: 'PARTY1',
      leader: members[0],
      members,
      maxMembers,
      isPrivate: true,
    },
  } as any;
}

function user(id: string, elo: number, overrides: Record<string, unknown> = {}) {
  return {
    discordId: id,
    ign: id.toUpperCase(),
    elo,
    isBanned: false,
    isFrozen: false,
    ...overrides,
  };
}

function guildFor(ids: string[], missing: string[] = []) {
  return {
    members: {
      cache: new Map(ids.filter(id => !missing.includes(id)).map(id => [id, { id }])),
      fetch: jest.fn(async (id: string) => {
        if (missing.includes(id)) throw new Error('missing');
        return { id };
      }),
    },
  } as any;
}

function mapService(maps: any[]) {
  return {
    getAllMaps: jest.fn().mockResolvedValue(maps),
    claimMap: jest.fn(),
  };
}

function gameManager(overrides: Record<string, jest.Mock> = {}) {
  return {
    createPrivateGame: jest.fn().mockResolvedValue({ gameId: 42 }),
    initiateGameWarp: jest.fn().mockResolvedValue(undefined),
    abortGame: jest.fn().mockResolvedValue(undefined),
    voidGame: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function wsFor(manager: any) {
  return { getGameManager: () => manager } as any;
}

function usersQuery(users: any[]) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(users) }) };
}

const maps = [
  { name: 'Duo', physical_name: 'Duo', maxplayers: 2, heightlimit: 100 },
  { name: 'Quad', physical_name: 'Quad', maxplayers: 4, heightlimit: 100 },
  { name: 'Octo', physical_name: 'Octo', maxplayers: 8, heightlimit: 100 },
];

describe('PrivateGameService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAllDraftClaims();
    queuePlayers.clear();
    validatePartyAccess.mockResolvedValue(party(['a', 'b', 'c', 'd']));
    evaluatePresence.mockReturnValue('online');
    getSharedInstance.mockReturnValue(mapService(maps));
    UserModel.find.mockReturnValue(usersQuery([
      user('a', 1600),
      user('b', 1400),
      user('c', 1200),
      user('d', 1000),
    ]));
    GameModel.findOne.mockReturnValue(chain(null));
  });

  it('creates an even, ELO-balanced private game and starts the warp', async () => {
    const manager = gameManager();
    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(manager),
    );

    expect(result.success).toBe(true);
    expect(result.gameId).toBe(42);
    expect(result.map).toBe('Quad');
    expect(result.team1).toHaveLength(2);
    expect(result.team2).toHaveLength(2);
    expect(manager.createPrivateGame).toHaveBeenCalledWith(expect.objectContaining({
      partyId: 'PARTY1',
      map: 'Quad',
    }));
    expect(manager.initiateGameWarp).toHaveBeenCalledWith(42);
  });

  it('rejects the party when a member is already in a public queue', async () => {
    queuePlayers.set('public-queue', ['a', 'stranger']);
    const manager = gameManager();

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(manager),
    );

    expect(result).toEqual({ success: false, message: 'Party members already in a queue: A' });
    expect(manager.createPrivateGame).not.toHaveBeenCalled();
  });

  it('rejects the party when matchmaking is already drafting a member', async () => {
    claimPlayers(['a'], 'public-queue');
    const manager = gameManager();

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(manager),
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/currently being processed by matchmaking/);
    expect(manager.createPrivateGame).not.toHaveBeenCalled();
  });

  it('honors an explicit map and claims it', async () => {
    validatePartyAccess.mockResolvedValue(party(['a', 'b']));
    UserModel.find.mockReturnValue(usersQuery([user('a', 1000), user('b', 1100)]));
    const service = mapService(maps);
    getSharedInstance.mockReturnValue(service);
    const manager = gameManager();

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b']),
      wsFor(manager),
      { map: 'duo' },
    );

    expect(result.success).toBe(true);
    expect(result.map).toBe('Duo');
    expect(service.claimMap).toHaveBeenCalledWith('Duo');
  });

  it('rejects a map that does not support the party size', async () => {
    validatePartyAccess.mockResolvedValue(party(['a', 'b']));
    UserModel.find.mockReturnValue(usersQuery([user('a', 1000), user('b', 1100)]));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b']),
      wsFor(gameManager()),
      { map: 'Quad' },
    );

    expect(result).toEqual({
      success: false,
      message: 'Map "Quad" supports 4 players, but this party has 2',
    });
  });

  it('rejects unknown maps instead of silently using a fallback', async () => {
    validatePartyAccess.mockResolvedValue(party(['a', 'b']));
    UserModel.find.mockReturnValue(usersQuery([user('a', 1000), user('b', 1100)]));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b']),
      wsFor(gameManager()),
      { map: 'Unknown' },
    );

    expect(result).toEqual({ success: false, message: 'Map "Unknown" was not found' });
  });

  it('reports when no map supports the party size', async () => {
    getSharedInstance.mockReturnValue(mapService([
      { name: 'Duo', physical_name: 'Duo', maxplayers: 2, heightlimit: 100 },
    ]));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'No available map supports 4 players' });
  });

  it('surfaces database failures while loading party members', async () => {
    UserModel.find.mockImplementation(() => {
      throw new Error('db down');
    });

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'Could not load party members from the database' });
  });

  it('rejects parties without an even number of players', async () => {
    validatePartyAccess.mockResolvedValue(party(['a', 'b', 'c']));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({
      success: false,
      message: 'Private games need an even number of players (2, 4, 6, or 8)',
    });
    expect(UserModel.find).not.toHaveBeenCalled();
  });

  it('rejects parties above the configured private game limit', async () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    validatePartyAccess.mockResolvedValue(party(members, 8));
    UserModel.find.mockReturnValue(usersQuery(members.map((id, index) => user(id, 1000 + index))));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(members),
      wsFor(gameManager()),
    );

    expect(result).toEqual({
      success: false,
      message: 'Party size 10 exceeds the private game limit of 8',
    });
  });

  it('rejects banned or frozen party members', async () => {
    validatePartyAccess.mockResolvedValue(party(['a', 'b']));
    UserModel.find.mockReturnValue(usersQuery([
      user('a', 1000),
      user('b', 1000, { isFrozen: true }),
    ]));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'Banned or frozen party members: B' });
  });

  it('rejects party members who are offline in Minecraft', async () => {
    validatePartyAccess.mockResolvedValue(party(['a', 'b']));
    UserModel.find.mockReturnValue(usersQuery([user('a', 1000), user('b', 1000)]));
    evaluatePresence.mockImplementation((ign: string) => (ign === 'B' ? 'offline' : 'online'));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'Party members offline in Minecraft: B' });
  });

  it('rejects party members who are already in a game', async () => {
    GameModel.findOne.mockReturnValue(chain({ gameId: 9, isPrivate: false }));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'A party member is already in game #9' });
  });

  it('reports an existing private game for the same party', async () => {
    GameModel.findOne.mockReturnValue(chain({ gameId: 9, isPrivate: true, privatePartyId: 'PARTY1' }));

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'Your party already has an active private game #9' });
  });

  it('rejects members who are not in the Discord server', async () => {
    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd'], ['b']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'Not in the Discord server: B' });
  });

  it('requires a party leader', async () => {
    validatePartyAccess.mockResolvedValue({ isValid: false, error: 'Not party leader' });

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(gameManager()),
    );

    expect(result).toEqual({ success: false, message: 'Not party leader' });
  });

  it('tears down a game when warp initiation fails', async () => {
    const manager = gameManager({
      initiateGameWarp: jest.fn().mockRejectedValue(new Error('warp down')),
    });

    const result = await PrivateGameService.startPrivateGame(
      'a',
      guildFor(['a', 'b', 'c', 'd']),
      wsFor(manager),
    );

    expect(result).toEqual({
      success: false,
      message: 'The private game could not be started and has been cancelled',
    });
    expect(manager.abortGame).toHaveBeenCalledWith(42, 'Private game warp failed');
  });

  it('prevents concurrent private game creation for the same party', async () => {
    let release!: (value: { gameId: number }) => void;
    const pending = new Promise<{ gameId: number }>(resolve => { release = resolve; });
    const manager = gameManager({ createPrivateGame: jest.fn().mockReturnValue(pending) });
    const ws = wsFor(manager);

    const first = PrivateGameService.startPrivateGame('a', guildFor(['a', 'b', 'c', 'd']), ws);
    const second = await PrivateGameService.startPrivateGame('a', guildFor(['a', 'b', 'c', 'd']), ws);

    expect(second.success).toBe(false);
    expect(second.message).toMatch(/already being created/);

    release({ gameId: 42 });
    await expect(first).resolves.toMatchObject({ success: true, gameId: 42 });
  });

  it('cancels the active private game for the party leader', async () => {
    GameModel.findOne.mockReturnValue(chain({ gameId: 12 }));
    const manager = gameManager();

    const result = await PrivateGameService.cancelPrivateGame('a', wsFor(manager));

    expect(result).toEqual({ success: true, gameId: 12 });
    expect(manager.voidGame).toHaveBeenCalledWith(12, 'Private game cancelled by party leader');
  });

  it('rejects cancellation when the party has no active private game', async () => {
    const manager = gameManager();

    const result = await PrivateGameService.cancelPrivateGame('a', wsFor(manager));

    expect(result).toEqual({ success: false, message: 'Your party does not have an active private game' });
    expect(manager.voidGame).not.toHaveBeenCalled();
  });
});
