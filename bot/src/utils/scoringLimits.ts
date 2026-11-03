import config from '../config/config';

export function getMaxMvpsPerGame(): number {
  const configured = Number(config.maxMvpsPerGame);
  if (!Number.isFinite(configured) || configured < 1) return 1;
  return Math.floor(configured);
}

export function getMaxBedBreakersPerGame(): number {
  const configured = Number(config.maxBedBreakersPerGame);
  if (!Number.isFinite(configured) || configured < 1) return 1;
  return Math.floor(configured);
}

export function uniquePlayers(players: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of players ?? []) {
    const name = String(value ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

export function limitPlayers(
  players: readonly string[] | undefined,
  limit: number,
): string[] {
  return uniquePlayers(players).slice(0, Math.max(1, Math.floor(limit)));
}

export function limitMvps(
  mvps: readonly string[] | undefined,
  limit = getMaxMvpsPerGame(),
): string[] {
  return limitPlayers(mvps, limit);
}

export function limitBedBreakers(
  bedBreakers: readonly string[] | undefined,
  limit = getMaxBedBreakersPerGame(),
): string[] {
  return limitPlayers(bedBreakers, limit);
}

export function mvpLimitMessage(limit = getMaxMvpsPerGame()): string {
  return `A game can have at most ${limit} MVP${limit === 1 ? '' : 's'}.`;
}

export function bedBreakerLimitMessage(limit = getMaxBedBreakersPerGame()): string {
  return `A game can have at most ${limit} bed breaker${limit === 1 ? '' : 's'}.`;
}
