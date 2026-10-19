import { apiBase, apiKey } from './config';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface CacheEntry {
  value: unknown;
  expires: number;
}

const memoryCache = new Map<string, CacheEntry>();
const MEM_MAX = 200;
const LS_PREFIX = 'rbw-cache:';
const LS_MAX = 80;

function memSet(key: string, entry: CacheEntry): void {
  memoryCache.set(key, entry);
  while (memoryCache.size > MEM_MAX) {
    const oldest = memoryCache.keys().next();
    if (oldest.done) break;
    memoryCache.delete(oldest.value);
  }
}

function readCacheEntry(key: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as CacheEntry).expires !== 'number') {
      localStorage.removeItem(key);
      return null;
    }
    return parsed as CacheEntry;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
    }
    return null;
  }
}

function lsGet(key: string): CacheEntry | null {
  const parsed = readCacheEntry(LS_PREFIX + key);
  if (!parsed) return null;
  if (parsed.expires < Date.now()) {
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
    }
    return null;
  }
  return parsed;
}

function lsExpiryOf(key: string): number {
  const parsed = readCacheEntry(key);
  return parsed ? parsed.expires : 0;
}

function lsSet(key: string, entry: CacheEntry): void {
  try {
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(LS_PREFIX))
      .map((k) => ({ k, expires: lsExpiryOf(k) }))
      .sort((a, b) => a.expires - b.expires);
    while (keys.length >= LS_MAX) {
      const victim = keys.shift();
      if (!victim) break;
      localStorage.removeItem(victim.k);
    }
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry));
  } catch {
  }
}

export interface ApiGetOptions {
  ttl?: number;
  force?: boolean;
}

export async function apiGet<T = unknown>(path: string, opts: ApiGetOptions = {}): Promise<T> {
  const ttl = opts.ttl !== undefined ? opts.ttl : 30000;
  const url = apiBase() + path;

  if (!opts.force) {
    const mem = memoryCache.get(url);
    if (mem && mem.expires > Date.now()) return mem.value as T;
    const ls = lsGet(url);
    if (ls) {
      memSet(url, ls);
      return ls.value as T;
    }
  }

  const headers: Record<string, string> = {};
  const key = apiKey();
  if (key) headers['x-api-key'] = key;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new ApiError('Cannot reach the Ranked Bedwars API.', 0);
  }

  if (res.status === 429) {
    throw new ApiError('Rate limited. Wait a moment and try again.', 429);
  }
  if (res.status === 401) {
    throw new ApiError('Unauthorized. The site needs an API key (see config.js) or RBW_PUBLIC_API=true on the bot.', 401);
  }
  if (!res.ok) {
    let msg = `API error (${res.status})`;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch {
    }
    throw new ApiError(msg, res.status);
  }

  const value = (await res.json()) as T;
  const entry: CacheEntry = { value, expires: Date.now() + ttl };
  memSet(url, entry);
  if (ttl > 0) lsSet(url, entry);
  return value;
}
