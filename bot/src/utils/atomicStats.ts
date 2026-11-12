/**
 * Turns "here are the player's new totals" into an update that adds the difference instead.
 *
 * Scoring and voiding load a player, work out their new ELO/stats in memory and used to write the
 * totals back with $set. Anything that changed that player in between (an admin ELO edit, ELO
 * decay, a second game finishing) was silently overwritten. Writing the difference with $inc keeps
 * both changes.
 */

/** Counters that only ever move by the game's own amount. */
const ADDITIVE_FIELDS = new Set([
  'elo', 'experience', 'games', 'wins', 'losses', 'mvps', 'kills', 'deaths', 'finalKills', 'finalDeaths',
  'bedBroken', 'diamonds', 'irons', 'gold', 'emeralds', 'blocksPlaced', 'damageDealt', 'damageTaken',
  'assists', 'firstBloods', 'playtimeSeconds',
]);

/** Records that can only grow: keep the higher of the stored and the new value. */
const MAX_FIELDS = new Set(['peakElo', 'bestStreak']);

export type NumericSnapshot = Record<string, number>;

/** Copies the numeric fields that may be turned into $inc, before the player is changed in memory. */
export function snapshotCounters(player: unknown): NumericSnapshot {
  const source = player as Record<string, unknown>;
  const snapshot: NumericSnapshot = {};
  for (const field of ADDITIVE_FIELDS) {
    const value = source?.[field];
    snapshot[field] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  return snapshot;
}

/**
 * Splits new totals into $inc (difference from the snapshot), $max and $set parts.
 * Fields that did not change are left out so they can't overwrite a concurrent change either.
 */
export function toAtomicUpdate(before: NumericSnapshot, totals: Record<string, unknown>): {
  $set?: Record<string, unknown>;
  $inc?: Record<string, number>;
  $max?: Record<string, number>;
} {
  const $set: Record<string, unknown> = {};
  const $inc: Record<string, number> = {};
  const $max: Record<string, number> = {};

  for (const [field, value] of Object.entries(totals)) {
    if (value === undefined) continue;
    if (ADDITIVE_FIELDS.has(field) && typeof value === 'number' && Number.isFinite(value)) {
      const delta = value - (before[field] ?? 0);
      if (delta !== 0) $inc[field] = delta;
    } else if (MAX_FIELDS.has(field) && typeof value === 'number' && Number.isFinite(value)) {
      $max[field] = value;
    } else {
      $set[field] = value;
    }
  }

  return {
    ...(Object.keys($set).length ? { $set } : {}),
    ...(Object.keys($inc).length ? { $inc } : {}),
    ...(Object.keys($max).length ? { $max } : {}),
  };
}

/** Bulk op that puts ELO back to 0 if adding a negative change took it below zero. */
export function clampEloOp(discordId: string): Record<string, unknown> {
  return {
    updateOne: {
      filter: { discordId, elo: { $lt: 0 } },
      update: { $set: { elo: 0 } },
    },
  };
}
