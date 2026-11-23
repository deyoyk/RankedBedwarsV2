import type { IRecentGame } from '../models/gameBase';
import { computeWlr } from './userStats';

const GAME_FIELDS = [
  'kills', 'deaths', 'finalKills', 'finalDeaths', 'bedBroken', 'diamonds', 'irons', 'gold', 'emeralds',
  'blocksPlaced', 'damageDealt', 'damageTaken', 'assists',
] as const;

const SUMMED = [
  'wins', 'losses', 'games', 'mvps', 'kills', 'deaths', 'bedBroken', 'finalKills', 'finalDeaths', 'diamonds', 'irons',
  'gold', 'emeralds', 'blocksPlaced', 'damageDealt', 'damageTaken', 'assists', 'firstBloods', 'playtimeSeconds',
] as const;

const BEST = ['peakElo', 'bestStreak'] as const;

type Stats = Record<string, number>;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function ratio(top: number, bottom: number): number {
  return bottom > 0 ? parseFloat((top / bottom).toFixed(2)) : top;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function dailyStats(recentGames: Partial<IRecentGame>[] | undefined, now: Date = new Date()): Stats {
  const out: Stats = { games: 0, wins: 0, losses: 0, mvps: 0, eloGain: 0 };
  for (const field of GAME_FIELDS) out[field] = 0;
  for (const game of recentGames ?? []) {
    if (game.state !== 'scored' || !game.date || !sameDay(new Date(game.date), now)) continue;
    out.games++;
    if (game.won) out.wins++;
    else out.losses++;
    if (game.isMvp) out.mvps++;
    out.eloGain += num(game.eloGain);
    for (const field of GAME_FIELDS) out[field] += num(game[field]);
  }
  out.kdr = ratio(out.kills, out.deaths);
  out.wlr = computeWlr(out.wins, out.losses);
  return out;
}

export function lifetimeStats(current: Record<string, unknown>, pastSeasons: Record<string, unknown>[]): Stats {
  const all = [current, ...pastSeasons];
  const out: Stats = { seasons: all.length };
  for (const field of SUMMED) out[field] = all.reduce((sum, s) => sum + num(s[field]), 0);
  for (const field of BEST) out[field] = Math.max(...all.map(s => num(s[field])));
  out.kdr = ratio(out.kills, out.deaths);
  out.wlr = computeWlr(out.wins, out.losses);
  return out;
}
