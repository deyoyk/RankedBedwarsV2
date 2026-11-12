const mockValidatePartyAccess = jest.fn();
const mockPartyFindOne = jest.fn();

jest.mock('../src/models/Game', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('../src/models/User', () => ({
  __esModule: true,
  default: { find: jest.fn() },
}));
jest.mock('../src/models/Party', () => ({
  __esModule: true,
  default: { findOne: (...args: unknown[]) => ({ lean: () => mockPartyFindOne(...args) }) },
}));
jest.mock('../src/services/PartyService', () => ({
  __esModule: true,
  PartyService: { validatePartyAccess: (...args: unknown[]) => mockValidatePartyAccess(...args) },
}));

import Game from '../src/models/Game';
import User from '../src/models/User';
import { PrivateGameService } from '../src/services/PrivateGameService';
import { queuePlayers } from '../src/types/queuePlayersMemory';

const GameModel = Game as unknown as { findOne: jest.Mock };
const UserModel = User as unknown as { find: jest.Mock };

function party(members: string[]) {
  return { isValid: true, party: { partyId: 'PARTY1', leader: members[0], members, maxMembers: 8 } } as any;
}

function user(id: string, overrides: Record<string, unknown> = {}) {
  return { discordId: id, ign: id.toUpperCase(), isBanned: false, isFrozen: false, ...overrides };
}

function usersQuery(users: any[]) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(users) }) };
}

function wsWith(answer: Record<string, unknown> = { ok: true, message: 'Hosting', map: 'Quad', players: [], missing: [] }) {
  const voidGame = jest.fn().mockResolvedValue(undefined);
  return {
    hostPrivateGame: jest.fn().mockResolvedValue(answer),
    getGameManager: () => ({ voidGame }),
    voidGame,
  } as any;
}

describe('PrivateGameService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queuePlayers.clear();
    mockValidatePartyAccess.mockResolvedValue(party(['a', 'b', 'c']));
    UserModel.find.mockReturnValue(usersQuery([user('a'), user('b'), user('c')]));
  });

  it("asks the server to host the party's game and creates nothing on the bot", async () => {
    const ws = wsWith({ ok: true, message: 'Hosting on Quad', map: 'Quad', players: ['A', 'B'], missing: ['C'] });
    const result = await PrivateGameService.startPrivateGame('a', ws, { map: 'Quad' });

    expect(ws.hostPrivateGame).toHaveBeenCalledWith({ map: 'Quad', players: ['A', 'B', 'C'] });
    expect(result).toEqual({ success: true, message: 'Hosting on Quad', map: 'Quad', players: ['A', 'B'], missing: ['C'] });
    expect(GameModel.findOne).not.toHaveBeenCalled();
  });

  it('leaves the map to the server when none is picked', async () => {
    const ws = wsWith();
    await PrivateGameService.startPrivateGame('a', ws);
    expect(ws.hostPrivateGame).toHaveBeenCalledWith({ map: undefined, players: ['A', 'B', 'C'] });
  });

  it("passes on the server's reason when it can't host", async () => {
    const ws = wsWith({ ok: false, message: 'Only 1 player is on the server', players: [], missing: ['B', 'C'] });
    await expect(PrivateGameService.startPrivateGame('a', ws)).resolves.toEqual({ success: false, message: 'Only 1 player is on the server' });
  });

  it('needs at least 2 players', async () => {
    mockValidatePartyAccess.mockResolvedValue(party(['a']));
    const ws = wsWith();
    const result = await PrivateGameService.startPrivateGame('a', ws);
    expect(result).toEqual({ success: false, message: 'A private game needs at least 2 players' });
    expect(ws.hostPrivateGame).not.toHaveBeenCalled();
  });

  it('rejects unregistered, banned and queued members before asking the server', async () => {
    const ws = wsWith();

    UserModel.find.mockReturnValue(usersQuery([user('a'), user('b')]));
    expect((await PrivateGameService.startPrivateGame('a', ws)).message).toBe('Some party members are not registered');

    UserModel.find.mockReturnValue(usersQuery([user('a'), user('b', { isBanned: true }), user('c')]));
    expect((await PrivateGameService.startPrivateGame('a', ws)).message).toBe('Banned or frozen party members: B');

    UserModel.find.mockReturnValue(usersQuery([user('a'), user('b'), user('c')]));
    queuePlayers.set('queue-1', ['c']);
    expect((await PrivateGameService.startPrivateGame('a', ws)).message).toBe('Party members already in a queue: C');

    expect(ws.hostPrivateGame).not.toHaveBeenCalled();
  });

  it('returns the party check error', async () => {
    mockValidatePartyAccess.mockResolvedValue({ isValid: false, error: 'Only the party leader can do this' });
    await expect(PrivateGameService.startPrivateGame('b', wsWith())).resolves.toEqual({ success: false, message: 'Only the party leader can do this' });
  });

  it('only starts one game at a time per party', async () => {
    let answer!: (value: unknown) => void;
    const ws = wsWith();
    ws.hostPrivateGame.mockReturnValue(new Promise(resolve => { answer = resolve; }));

    const first = PrivateGameService.startPrivateGame('a', ws);
    await new Promise(resolve => setImmediate(resolve));
    const second = await PrivateGameService.startPrivateGame('a', ws);
    expect(second).toEqual({ success: false, message: 'A private game is already being started for your party' });

    answer({ ok: true, message: '', players: [], missing: [] });
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it('sends a duel as one team per party', async () => {
    mockPartyFindOne.mockImplementation(({ partyId }: { partyId: string }) => Promise.resolve(
      partyId === 'P1' ? { partyId: 'P1', members: ['a', 'b'] } : { partyId: 'P2', members: ['c', 'd'] },
    ));
    UserModel.find.mockReturnValue(usersQuery([user('a'), user('b'), user('c'), user('d')]));
    const ws = wsWith();

    const result = await PrivateGameService.startDuel('P1', 'P2', ws, { map: 'Quad' });

    expect(ws.hostPrivateGame).toHaveBeenCalledWith({ map: 'Quad', teams: [['A', 'B'], ['C', 'D']] });
    expect(result.success).toBe(true);
  });

  it("can't duel a party that no longer exists", async () => {
    mockPartyFindOne.mockResolvedValue(null);
    await expect(PrivateGameService.startDuel('P1', 'P2', wsWith())).resolves.toEqual({ success: false, message: 'One of the parties no longer exists' });
  });

  it('still cancels a private game left over from before', async () => {
    GameModel.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ gameId: 12 }) }) });
    const ws = wsWith();
    await expect(PrivateGameService.cancelPrivateGame('a', ws)).resolves.toEqual({ success: true, gameId: 12 });
    expect(ws.voidGame).toHaveBeenCalledWith(12, 'Private game cancelled by party leader');
  });
});
