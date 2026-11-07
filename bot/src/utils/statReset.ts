export type StatResetScope = 'season' | 'days';

export interface StatResetEntry {
  date: Date | string;
  seasonNumber?: number | null;
  chapterNumber?: number | null;
}

export interface CurrentSeasonRef {
  seasonNumber: number;
  chapterNumber: number;
}

export function getStatResetAllowance(memberRoleIds: Iterable<string>, roles: Record<string, number>): number {
  let best = 0;
  for (const roleId of memberRoleIds) {
    const allowed = roles[roleId];
    if (typeof allowed === 'number' && allowed > best) best = allowed;
  }
  return best;
}

export function countStatResetsInWindow(
  resets: readonly StatResetEntry[] | undefined | null,
  scope: StatResetScope,
  windowDays: number,
  currentSeason: CurrentSeasonRef | null,
  now: Date = new Date()
): number {
  if (!Array.isArray(resets) || resets.length === 0) return 0;
  if (scope === 'season') {
    if (!currentSeason) return 0;
    let count = 0;
    for (const r of resets) {
      if (r.seasonNumber === currentSeason.seasonNumber && r.chapterNumber === currentSeason.chapterNumber) count++;
    }
    return count;
  }
  const days = Number.isInteger(windowDays) && windowDays > 0 ? windowDays : 30;
  const threshold = now.getTime() - days * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const r of resets) {
    const t = new Date(r.date).getTime();
    if (!Number.isNaN(t) && t >= threshold) count++;
  }
  return count;
}
