import type { DivisionTag } from '../assets/divisionTag';

const DIVISION_PRIORITY: DivisionTag[] = ['premium', 'pugs', 'pups', 'pit'];
const MAX_CACHE_ENTRIES = 5000;

type CacheEntry = {
  at: number;
  tag: DivisionTag | null;
};

type LookupResult = {
  tag: DivisionTag | null;
  cacheable: boolean;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DivisionTag | null>>();

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function apiSettings(): { url: string; key: string } | null {
  const url = (process.env.PPP_API_URL ?? '').trim().replace(/\/+$/, '');
  const key = (process.env.PPP_API_KEY ?? '').trim();
  if (!url || !key) return null;
  return { url, key };
}

export function pickDivisionTag(divisions: unknown): DivisionTag | null {
  if (!Array.isArray(divisions)) return null;
  const present = new Set<string>();
  for (const entry of divisions) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { division?: unknown }).division;
    if (typeof name === 'string') present.add(name.toLowerCase());
  }
  return DIVISION_PRIORITY.find(tag => present.has(tag)) ?? null;
}

async function fetchDivisionTag(
  discordId: string,
  settings: { url: string; key: string },
  timeoutMs: number,
): Promise<LookupResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${settings.url}/members/${encodeURIComponent(discordId)}`, {
      headers: { 'x-api-key': settings.key },
      signal: controller.signal,
    });
    if (res.status === 404) return { tag: null, cacheable: true };
    if (!res.ok) return { tag: null, cacheable: false };
    const payload = await res.json() as { divisions?: unknown };
    return { tag: pickDivisionTag(payload.divisions), cacheable: true };
  } catch {
    return { tag: null, cacheable: false };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDivisionTag(discordId?: string | null): Promise<DivisionTag | null> {
  const id = typeof discordId === 'string' ? discordId.trim() : '';
  if (!id) return null;

  const settings = apiSettings();
  if (!settings) return null;

  const ttlMs = envInt('PPP_API_CACHE_MS', 60000, 0, 3600000);
  const cached = cache.get(id);
  if (cached && ttlMs > 0 && Date.now() - cached.at < ttlMs) return cached.tag;

  const ongoing = inflight.get(id);
  if (ongoing) return ongoing;

  const task = (async () => {
    const result = await fetchDivisionTag(id, settings, envInt('PPP_API_TIMEOUT_MS', 2000, 250, 10000));
    if (result.cacheable && ttlMs > 0) {
      if (!cache.has(id) && cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(id, { at: Date.now(), tag: result.tag });
    }
    return result.tag;
  })();

  inflight.set(id, task);
  try {
    return await task;
  } finally {
    inflight.delete(id);
  }
}
