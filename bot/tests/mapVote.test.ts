import { tallyMapVotes } from '../src/utils/mapVote';

describe('tallyMapVotes', () => {
  const candidates = ['A', 'B', 'C'];

  it('counts one vote per player and returns the highest map', () => {
    const votes = new Map([
      ['p1', 'B'],
      ['p2', 'B'],
      ['p3', 'A'],
    ]);
    const result = tallyMapVotes(votes, candidates);
    expect(result.winner).toBe('B');
    expect(result.tied).toEqual(['B']);
    expect(result.totalVotes).toBe(3);
    expect(result.counts).toEqual([
      { name: 'A', votes: 1 },
      { name: 'B', votes: 2 },
      { name: 'C', votes: 0 },
    ]);
  });

  it('keeps only the latest vote when a player votes twice', () => {
    const votes = new Map([
      ['p1', 'A'],
      ['p1', 'C'],
    ]);
    const result = tallyMapVotes(votes, candidates);
    expect(result.winner).toBe('C');
    expect(result.totalVotes).toBe(1);
  });

  it('reports every tied map and resolves the tie to the higher-rated candidate', () => {
    const votes = new Map([
      ['p1', 'B'],
      ['p2', 'C'],
    ]);
    const result = tallyMapVotes(votes, candidates);
    expect(result.tied).toEqual(['B', 'C']);
    expect(result.winner).toBe('B');
  });

  it('picks the first rated candidate when nobody votes', () => {
    const result = tallyMapVotes(new Map(), candidates);
    expect(result.totalVotes).toBe(0);
    expect(result.tied).toEqual(candidates);
    expect(result.winner).toBe('A');
  });

  it('ignores votes for maps outside the ballot', () => {
    const result = tallyMapVotes(new Map([['p1', 'Not-A-Map']]), candidates);
    expect(result.totalVotes).toBe(0);
    expect(result.winner).toBe('A');
  });

  it('returns no winner for an empty ballot', () => {
    const result = tallyMapVotes(new Map(), []);
    expect(result.winner).toBeNull();
    expect(result.counts).toEqual([]);
  });
});
