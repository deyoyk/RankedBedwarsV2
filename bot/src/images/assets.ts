import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

export type ImageFont = {
  name: string;
  data: Buffer;
  weight: 400;
  style: 'normal';
};

const FONT_SPECS = [
  { name: 'ADAMCGPRO', file: 'ADAM.CG PRO.otf' },
  { name: 'PoppinsLight', file: 'Poppins-ExtraLight.ttf' },
  { name: 'PoppinsMedium', file: 'Poppins-Medium.ttf' },
  { name: 'PoppinsRegular', file: 'Poppins-Regular.ttf' },
];

let cachedFonts: ImageFont[] | null = null;

export function loadImageFonts(): ImageFont[] {
  if (cachedFonts) return cachedFonts;
  cachedFonts = [];
  for (const spec of FONT_SPECS) {
    const full = path.resolve(process.cwd(), 'src', 'asserts', 'fonts', spec.file);
    if (!fs.existsSync(full)) continue;
    cachedFonts.push({ name: spec.name, data: fs.readFileSync(full), weight: 400, style: 'normal' });
  }
  return cachedFonts;
}

const dataUrlCache = new Map<string, string>();

export function staticImageDataUrl(dir: 'themes' | 'games' | 'fallbacks', file: string): string {
  const key = `${dir}/${file}`;
  const hit = dataUrlCache.get(key);
  if (hit) return hit;
  const buf = fs.readFileSync(path.resolve(process.cwd(), 'src', 'asserts', dir, file));
  const url = `data:image/png;base64,${buf.toString('base64')}`;
  dataUrlCache.set(key, url);
  return url;
}

async function fetchImageDataUrl(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface AvatarCacheEntry {
  at: number;
  dataUrl: string;
  ok: boolean;
}

const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
const AVATAR_NEGATIVE_TTL_MS = 60 * 1000;
const AVATAR_MAX_ENTRIES = 5000;
const AVATAR_MAX_CONCURRENT = 4;

const avatarCache = new Map<string, AvatarCacheEntry>();
const avatarInflight = new Map<string, Promise<string>>();
const avatarWaitQueue: Array<() => void> = [];
let avatarInFlightCount = 0;

function avatarCached(key: string, now: number): string | null {
  const entry = avatarCache.get(key);
  if (!entry) return null;
  const ttl = entry.ok ? AVATAR_TTL_MS : AVATAR_NEGATIVE_TTL_MS;
  if (now - entry.at > ttl) {
    avatarCache.delete(key);
    return null;
  }
  return entry.dataUrl;
}

function avatarCacheStore(key: string, dataUrl: string, ok: boolean): void {
  if (!avatarCache.has(key) && avatarCache.size >= AVATAR_MAX_ENTRIES) {
    const oldest = avatarCache.keys().next();
    if (!oldest.done) avatarCache.delete(oldest.value);
  }
  avatarCache.set(key, { at: Date.now(), dataUrl, ok });
}

function acquireAvatarSlot(): Promise<void> {
  if (avatarInFlightCount < AVATAR_MAX_CONCURRENT) {
    avatarInFlightCount += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    avatarWaitQueue.push(() => {
      avatarInFlightCount += 1;
      resolve();
    });
  });
}

function releaseAvatarSlot(): void {
  const next = avatarWaitQueue.shift();
  if (next) {
    next();
  } else {
    avatarInFlightCount = Math.max(0, avatarInFlightCount - 1);
  }
}

export async function loadAvatarDataUrl(username: string): Promise<string> {
  const key = username.toLowerCase();
  const hit = avatarCached(key, Date.now());
  if (hit) return hit;
  const ongoing = avatarInflight.get(key);
  if (ongoing) return ongoing;
  const task = (async (): Promise<string> => {
    await acquireAvatarSlot();
    try {
      const remote = await fetchImageDataUrl(`https://mineskin.eu/avatar/${encodeURIComponent(username)}/40`, 2000);
      if (remote) {
        avatarCacheStore(key, remote, true);
        return remote;
      }
      const fallback = staticImageDataUrl('fallbacks', 'steve.png');
      avatarCacheStore(key, fallback, false);
      return fallback;
    } finally {
      avatarInflight.delete(key);
      releaseAvatarSlot();
    }
  })();
  avatarInflight.set(key, task);
  return task;
}

export async function loadSkinDataUrl(ign: string): Promise<string | null> {
  const heads = await fetchImageDataUrl(`https://mc-heads.net/body/${encodeURIComponent(ign)}/144`, 4000);
  if (heads) return heads;
  return fetchImageDataUrl(`https://nmsr.nickac.dev/fullbody/${encodeURIComponent(ign)}`, 4000);
}
