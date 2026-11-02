const claims = new Map<string, { owner: string; expiresAt: number }>();
const CLAIM_TTL_MS = 180000;

function prune(now: number = Date.now()): void {
  for (const [playerId, claim] of claims) {
    if (claim.expiresAt <= now) {
      claims.delete(playerId);
    }
  }
}

export function claimPlayers(playerIds: string[], ownerQueueId: string, ttlMs: number = CLAIM_TTL_MS): string[] {
  prune();
  const claimed: string[] = [];
  const now = Date.now();
  for (const playerId of new Set(playerIds)) {
    const existing = claims.get(playerId);
    if (!existing || existing.owner === ownerQueueId) {
      claims.set(playerId, { owner: ownerQueueId, expiresAt: now + ttlMs });
      claimed.push(playerId);
    }
  }
  return claimed;
}

export function releasePlayers(playerIds: string[], ownerQueueId: string): void {
  for (const playerId of playerIds) {
    const existing = claims.get(playerId);
    if (existing && existing.owner === ownerQueueId) {
      claims.delete(playerId);
    }
  }
}

export function isClaimedByOther(playerId: string, ownerQueueId: string): boolean {
  prune();
  const existing = claims.get(playerId);
  return !!existing && existing.owner !== ownerQueueId;
}

export function clearAllDraftClaims(): void {
  claims.clear();
}
