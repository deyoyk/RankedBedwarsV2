import { dailyStats, lifetimeStats } from '../src/utils/periodStats';

const today = new Date(2026, 10, 22, 20, 0, 0);
const game = (over: Record<string, unknown>) => ({
  gameId: 1, map: 'Archway', eloGain: 0, kills: 0, deaths: 0, bedBroken: 0, finalKills: 0,
  won: false, date: new Date(2026, 10, 22, 12), state: 'scored', startTime: new Date(2026, 10, 22, 12), ...over,
});

describe('daily stats', () => {
  test('adds up only the scored games played today, with the ELO gained', () => {
    const d = dailyStats([
      game({ eloGain: 35, won: true, kills: 6, deaths: 2, bedBroken: 1, finalKills: 3, diamonds: 4, isMvp: true }),
      game({ eloGain: -15, kills: 2, deaths: 4, finalDeaths: 1, irons: 90 }),
      game({ eloGain: 40, won: true, kills: 9, state: 'voided' }),
      game({ eloGain: 0, kills: 3, state: 'pending' }),
      game({ eloGain: 30, won: true, kills: 5, date: new Date(2026, 10, 21, 23, 59) }),
    ], today);
    expect(d).toMatchObject({
      games: 2, wins: 1, losses: 1, eloGain: 20, kills: 8, deaths: 6, kdr: 1.33, finalKills: 3, finalDeaths: 1,
      bedBroken: 1, mvps: 1, diamonds: 4, irons: 90, wlr: 1,
    });
  });

  test('a player who has not played today has all zeroes', () => {
    expect(dailyStats(undefined, today)).toMatchObject({ games: 0, eloGain: 0, kills: 0, kdr: 0, wlr: 0 });
  });
});

describe('lifetime stats', () => {
  test('adds every past season to this one and keeps the best peak and streak', () => {
    const l = lifetimeStats(
      { elo: 900, wins: 10, losses: 5, games: 15, kills: 100, deaths: 50, peakElo: 950, bestStreak: 4, winStreak: 2 },
      [
        { elo: 1300, wins: 30, losses: 20, games: 50, kills: 400, deaths: 350, peakElo: 1400, bestStreak: 9 },
        { elo: 600, wins: 5, losses: 15, games: 20, kills: 50, deaths: 100, peakElo: 700, bestStreak: 2 },
      ],
    );
    expect(l).toMatchObject({ wins: 45, losses: 40, games: 85, kills: 550, deaths: 500, peakElo: 1400, bestStreak: 9, seasons: 3 });
    expect(l.kdr).toBe(1.1);
    expect(l.wlr).toBe(1.13);
    expect(l).not.toHaveProperty('elo');
    expect(l).not.toHaveProperty('winStreak');
  });
});
