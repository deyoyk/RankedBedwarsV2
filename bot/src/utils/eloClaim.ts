export interface EloClaimEntry {
  date?: Date | string;
  seasonNumber?: number | null;
  chapterNumber?: number | null;
  roleId?: string | null;
  amount?: number | null;
}

export interface CurrentSeasonRef {
  seasonNumber: number;
  chapterNumber: number;
}

export interface EloClaimGrant {
  roleId: string;
  amount: number;
}

export type EloClaimEligibility = 'eligible' | 'no-season' | 'played' | 'claimed';

/**
 * Returns the highest ELO amount among the member's configured roles.
 * This mirrors how stat reset allowances pick the best matching role.
 */
export function getEloClaimGrant(
  memberRoleIds: Iterable<string>,
  roles: Record<string, number>,
): EloClaimGrant | null {
  let best: EloClaimGrant | null = null;
  for (const roleId of memberRoleIds) {
    const amount = roles[roleId];
    if (typeof amount === 'number' && amount > 0 && (!best || amount > best.amount)) {
      best = { roleId, amount };
    }
  }
  return best;
}

export function hasClaimedEloThisSeason(
  claims: readonly EloClaimEntry[] | undefined | null,
  currentSeason: CurrentSeasonRef | null,
): boolean {
  if (!Array.isArray(claims) || claims.length === 0 || !currentSeason) return false;
  return claims.some(claim =>
    claim.seasonNumber === currentSeason.seasonNumber
    && claim.chapterNumber === currentSeason.chapterNumber
  );
}

/**
 * A claim is only allowed once per season, before the player has played any
 * game in that season. Missing game counters are treated as zero so legacy
 * documents that predate the field can still claim.
 */
export function getEloClaimEligibility(
  games: number | null | undefined,
  claims: readonly EloClaimEntry[] | undefined | null,
  currentSeason: CurrentSeasonRef | null,
): EloClaimEligibility {
  if (!currentSeason) return 'no-season';
  if (typeof games === 'number' && games > 0) return 'played';
  if (hasClaimedEloThisSeason(claims, currentSeason)) return 'claimed';
  return 'eligible';
}
