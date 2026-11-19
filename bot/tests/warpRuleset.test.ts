import { GameManager } from '../src/Matchmaking/GameManager';

jest.mock('../src/models/Game', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/models/User', () => ({ __esModule: true, default: { find: jest.fn(), findOne: jest.fn() } }));
jest.mock('../src/models/EloRank', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../src/models/Queue', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../src/models/Counter', () => ({ getNextSequence: jest.fn(), Counter: { updateOne: jest.fn() } }));
jest.mock('../src/utils/fix', () => ({ fix: jest.fn(), safeFix: jest.fn() }));
jest.mock('../src/managers/WorkersManager', () => ({ WorkersManager: { getInstance: () => ({}) } }));

const QueueModel = require('../src/models/Queue').default;
const wsManagerMock = { send: jest.fn(), setGlobalHandler: jest.fn() };
const clientMock = { guilds: { cache: { first: () => undefined } }, channels: { cache: { get: () => undefined } } };

function queueWith(ruleset: unknown) {
  return { select: () => ({ lean: async () => (ruleset === undefined ? null : { ruleset }) }) };
}

describe('warp ruleset', () => {
  const managers: GameManager[] = [];
  const make = () => {
    const m = new GameManager(clientMock as any, wsManagerMock as any);
    managers.push(m);
    return m as any;
  };

  afterAll(() => managers.forEach(m => m.cleanup()));
  beforeEach(() => jest.clearAllMocks());

  it('reads the queue ruleset, falling back to normal', async () => {
    const m = make();
    QueueModel.findOne.mockReturnValue(queueWith('ppp'));
    expect(await m.queueRuleset('queue-1')).toBe('ppp');
    QueueModel.findOne.mockReturnValue(queueWith(undefined));
    expect(await m.queueRuleset('queue-1')).toBe('normal');
    QueueModel.findOne.mockReturnValue(queueWith('weird'));
    expect(await m.queueRuleset('queue-1')).toBe('normal');
    expect(await m.queueRuleset(undefined)).toBe('normal');
  });

  it('falls back to normal when the queue cannot be read', async () => {
    const m = make();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    QueueModel.findOne.mockImplementation(() => { throw new Error('db down'); });
    expect(await m.queueRuleset('queue-1')).toBe('normal');
  });

  it('sends the ruleset with the warp', () => {
    const m = make();
    m.sendWarpPayload('7', { map: 'MapA', isRanked: true, isPrivate: false, ruleset: 'ppp', team1IGNs: ['A'], team2IGNs: ['B'] });
    expect(wsManagerMock.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'warp_players', game_id: '7', ruleset: 'ppp' }));
    m.sendWarpPayload('8', { map: 'MapA', isRanked: true, team1IGNs: ['A'], team2IGNs: ['B'] });
    expect(wsManagerMock.send).toHaveBeenLastCalledWith(expect.objectContaining({ ruleset: 'normal' }));
  });
});
