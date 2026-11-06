import User from '../models/User';

const IGN_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 60_000;
const MAX_ENTRIES = 20_000;
const QUERY_CHUNK = 500;

type CacheEntry = { ign: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const misses = new Map<string, number>();

function normalizeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = (raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function remember(key: string, ign: string, now: number): void {
  // Re-insert so the Map stays in least-recently-used order.
  cache.delete(key);
  cache.set(key, { ign, expiresAt: now + IGN_TTL_MS });
}

function trim(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  for (const [key, at] of misses) {
    if (now - at >= MISS_TTL_MS) misses.delete(key);
  }
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Resolves Discord IDs to Minecraft IGNs through one shared, bounded cache.
 * Queue status broadcast, matchmaking and queue admission all use this instead
 * of each running their own full User query.
 */
export async function getPlayerIgns(ids: string[]): Promise<Map<string, string>> {
  const unique = normalizeIds(ids);
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const now = Date.now();
  const missing: string[] = [];
  for (const id of unique) {
    const entry = cache.get(id);
    if (entry && entry.expiresAt > now) {
      remember(id, entry.ign, now);
      result.set(id, entry.ign);
      continue;
    }
    if (entry) cache.delete(id);
    const missedAt = misses.get(id);
    if (missedAt !== undefined && now - missedAt < MISS_TTL_MS) continue;
    missing.push(id);
  }

  for (let offset = 0; offset < missing.length; offset += QUERY_CHUNK) {
    const chunk = missing.slice(offset, offset + QUERY_CHUNK);
    try {
      const users = await User.find({ discordId: { $in: chunk } })
        .select('discordId ign')
        .lean() as Array<{ discordId: string; ign?: string }>;
      const found = new Set<string>();
      for (const user of users) {
        if (!user.discordId || !user.ign) continue;
        found.add(user.discordId);
        remember(user.discordId, user.ign, now);
        result.set(user.discordId, user.ign);
      }
      for (const id of chunk) {
        if (!found.has(id)) misses.set(id, now);
      }
    } catch (error) {
      console.error('[PlayerDirectory] Error resolving IGNs:', error);
    }
  }

  trim(now);
  return result;
}

export function clearPlayerDirectoryCache(): void {
  cache.clear();
  misses.clear();
}
