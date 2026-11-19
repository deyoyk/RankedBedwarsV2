import { GameManager } from '../src/Matchmaking/GameManager';

jest.mock('../src/models/Game', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/models/User', () => ({ __esModule: true, default: { find: jest.fn(), findOne: jest.fn() } }));
jest.mock('../src/models/EloRank', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/models/Counter', () => ({ getNextSequence: jest.fn(), Counter: { updateOne: jest.fn() } }));
jest.mock('../src/utils/fix', () => ({ fix: jest.fn(), safeFix: jest.fn() }));
jest.mock('../src/managers/WorkersManager', () => ({ WorkersManager: { getInstance: () => ({}) } }));
jest.mock('../src/utils/playerDirectory', () => ({
  getPlayerIgns: jest.fn(async (ids: string[]) => new Map(ids.filter(id => id !== 'noign').map(id => [id, id.toUpperCase()]))),
}));

const UserModel = require('../src/models/User').default;
const wsManagerMock = { send: jest.fn(), setGlobalHandler: jest.fn() };
const clientMock = { guilds: { cache: { first: () => undefined } }, channels: { cache: { get: () => undefined } } };

function usersWith(rows: Array<{ discordId: string; partyId?: string | null }>) {
  return { select: () => ({ lean: async () => rows }) };
}

describe('warp parties', () => {
  const managers: GameManager[] = [];
  const make = () => {
    const m = new GameManager(clientMock as any, wsManagerMock as any);
    managers.push(m);
    return m as any;
  };

  afterAll(() => managers.forEach(m => m.cleanup()));
  beforeEach(() => jest.clearAllMocks());

  it('groups players by party, as IGNs, leaving out solo parties and players without an IGN', async () => {
    const m = make();
    UserModel.find.mockReturnValue(usersWith([
      { discordId: 'a', partyId: 'p1' }, { discordId: 'b', partyId: 'p1' },
      { discordId: 'c', partyId: 'p2' },
      { discordId: 'd', partyId: 'p3' }, { discordId: 'e', partyId: 'p3' }, { discordId: 'noign', partyId: 'p3' },
      { discordId: 'f', partyId: 'p4' }, { discordId: 'noign', partyId: 'p4' },
    ]));
    expect(await m.partyGroups(['a', 'b', 'c', 'd', 'e', 'f', 'noign'])).toEqual([['A', 'B'], ['D', 'E']]);
  });

  it('sends no parties when the database fails', async () => {
    const m = make();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    UserModel.find.mockImplementation(() => { throw new Error('db down'); });
    expect(await m.partyGroups(['a'])).toEqual([]);
  });

  it('puts the parties in the warp', () => {
    const m = make();
    m.sendWarpPayload('9', { map: 'MapA', isRanked: true, parties: [['A', 'B']], team1IGNs: ['A'], team2IGNs: ['B'] });
    expect(wsManagerMock.send).toHaveBeenCalledWith(expect.objectContaining({ parties: [['A', 'B']] }));
    m.sendWarpPayload('10', { map: 'MapA', isRanked: true, team1IGNs: ['A'], team2IGNs: ['B'] });
    expect(wsManagerMock.send).toHaveBeenLastCalledWith(expect.objectContaining({ parties: [] }));
  });
});
