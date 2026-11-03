import config from '../config/config';

export function getMaxMvpsPerGame(): number {
  const configured = Number(config.maxMvpsPerGame);
  if (!Number.isFinite(configured) || configured < 1) return 1;
  return Math.floor(configured);
}

export function uniqueMvps(mvps: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of mvps ?? []) {
    const name = String(value ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(name);
  }
  return unique;
}

export function limitMvps(
  mvps: readonly string[] | undefined,
  limit = getMaxMvpsPerGame(),
): string[] {
  return uniqueMvps(mvps).slice(0, Math.max(1, Math.floor(limit)));
}

export function mvpLimitMessage(limit = getMaxMvpsPerGame()): string {
  return `A game can have at most ${limit} MVP${limit === 1 ? '' : 's'}.`;
}
