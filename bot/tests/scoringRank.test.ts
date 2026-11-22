import { rankForElo } from '../src/utils/rankInfo';

const rank = (startElo: number, endElo: number, winElo: number) => ({ roleId: `r${startElo}`, startElo, endElo, winElo });

describe('the rank used for scoring', () => {
  const ranks = [rank(1, 499, 30), rank(500, 999, 25), rank(1000, 99999, 20)];

  test('is the rank whose range holds the ELO', () => {
    expect(rankForElo(750, ranks)?.winElo).toBe(25);
    expect(rankForElo(1000, ranks)?.winElo).toBe(20);
  });

  test('below every range it is the lowest rank, like the rank shown on the results', () => {
    expect(rankForElo(0, ranks)?.winElo).toBe(30);
  });

  test('above every range it is the top rank', () => {
    expect(rankForElo(150000, ranks)?.winElo).toBe(20);
  });

  test('no ranks at all means no rank', () => {
    expect(rankForElo(100, [])).toBeUndefined();
  });
});
