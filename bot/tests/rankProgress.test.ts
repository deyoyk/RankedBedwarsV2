import { rankProgressFor } from '../src/utils/rankInfo';

jest.mock('../src/models/EloRank', () => ({ __esModule: true, default: { find: jest.fn() } }));

const ranks = [
  { roleId: 'gold', startElo: 200, endElo: 399, winElo: 25 },
  { roleId: 'iron', startElo: 0, endElo: 199, winElo: 30 },
  { roleId: 'diamond', startElo: 400, endElo: 99999, winElo: 20 },
];

const guild = {
  roles: {
    cache: new Map([
      ['iron', { name: 'Iron', color: 0xaaaaaa, hexColor: '#aaaaaa', iconURL: () => null }],
      ['gold', { name: 'Gold', color: 0xffaa00, hexColor: '#ffaa00', iconURL: () => null }],
      ['diamond', { name: 'Diamond', color: 0x55ffff, hexColor: '#55ffff', iconURL: () => null }],
    ]),
  },
} as any;

describe('rankProgressFor', () => {
  it('gives the current rank, its win ELO and the next rank, whatever order the ranks are stored in', () => {
    expect(rankProgressFor(250, ranks, guild)).toEqual({
      name: 'Gold', color: '#ffaa00', start: 200, end: 399, win_elo: 25,
      next: { name: 'Diamond', color: '#55ffff', start: 400 },
    });
  });

  it('has no next rank at the top', () => {
    expect(rankProgressFor(5000, ranks, guild)?.next).toBeNull();
  });

  it('puts an ELO below every rank in the lowest one', () => {
    expect(rankProgressFor(-5, ranks, guild)?.name).toBe('Iron');
  });

  it('returns null when no ranks are set up', () => {
    expect(rankProgressFor(100, [], guild)).toBeNull();
  });
});
