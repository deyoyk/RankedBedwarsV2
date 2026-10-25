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

interface CachedImageEntry {
  at: number;
  dataUrl: string;
  ok: boolean;
}

const IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_NEGATIVE_TTL_MS = 60 * 1000;
const IMAGE_MAX_ENTRIES = 5000;
const IMAGE_MAX_CONCURRENT = 4;
const IMAGE_ACQUIRE_TIMEOUT_MS = 5000;

interface ImageWaiter {
  resolve: (acquired: boolean) => void;
  timer: NodeJS.Timeout;
}

const imageCache = new Map<string, CachedImageEntry>();
const imageInflight = new Map<string, Promise<string | null>>();
const imageWaitQueue: ImageWaiter[] = [];
let imageInFlightCount = 0;

function imageCacheGet(key: string, now: number): string | null {
  const entry = imageCache.get(key);
  if (!entry) return null;
  const ttl = entry.ok ? IMAGE_TTL_MS : IMAGE_NEGATIVE_TTL_MS;
  if (now - entry.at > ttl) {
    imageCache.delete(key);
    return null;
  }
  return entry.dataUrl;
}

function imageCacheStore(key: string, dataUrl: string, ok: boolean): void {
  if (!imageCache.has(key) && imageCache.size >= IMAGE_MAX_ENTRIES) {
    const oldest = imageCache.keys().next();
    if (!oldest.done) imageCache.delete(oldest.value);
  }
  imageCache.set(key, { at: Date.now(), dataUrl, ok });
}

function acquireImageSlot(): Promise<boolean> {
  if (imageInFlightCount < IMAGE_MAX_CONCURRENT) {
    imageInFlightCount += 1;
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const waiter: ImageWaiter = {
      resolve,
      timer: setTimeout(() => {
        const idx = imageWaitQueue.indexOf(waiter);
        if (idx >= 0) imageWaitQueue.splice(idx, 1);
        resolve(false);
      }, IMAGE_ACQUIRE_TIMEOUT_MS)
    };
    imageWaitQueue.push(waiter);
  });
}

function releaseImageSlot(): void {
  const next = imageWaitQueue.shift();
  if (next) {
    clearTimeout(next.timer);
    imageInFlightCount += 1;
    next.resolve(true);
  } else {
    imageInFlightCount = Math.max(0, imageInFlightCount - 1);
  }
}

async function loadCachedImage(
  key: string,
  loader: () => Promise<{ dataUrl: string | null; ok: boolean; negativeCache?: string | null }>
): Promise<string | null> {
  const hit = imageCacheGet(key, Date.now());
  if (hit) return hit;
  const ongoing = imageInflight.get(key);
  if (ongoing) return ongoing;
  const task = (async (): Promise<string | null> => {
    const acquired = await acquireImageSlot();
    if (!acquired) {
      imageInflight.delete(key);
      return null;
    }
    try {
      const result = await loader();
      if (result.dataUrl) {
        imageCacheStore(key, result.dataUrl, result.ok);
        return result.dataUrl;
      }
      if (result.negativeCache) {
        imageCacheStore(key, result.negativeCache, false);
        return result.negativeCache;
      }
      return null;
    } finally {
      imageInflight.delete(key);
      releaseImageSlot();
    }
  })();
  imageInflight.set(key, task);
  return task;
}

export async function loadAvatarDataUrl(username: string): Promise<string> {
  const key = `avatar:${username.toLowerCase()}`;
  const img = await loadCachedImage(key, async () => {
    const remote = await fetchImageDataUrl(`https://mineskin.eu/avatar/${encodeURIComponent(username)}/40`, 2000);
    if (remote) return { dataUrl: remote, ok: true };
    return { dataUrl: null, ok: false, negativeCache: staticImageDataUrl('fallbacks', 'steve.png') };
  });
  if (img) return img;
  return staticImageDataUrl('fallbacks', 'steve.png');
}

export async function loadSkinDataUrl(ign: string): Promise<string | null> {
  const key = `skin:${ign.toLowerCase()}`;
  return loadCachedImage(key, async () => {
    const heads = await fetchImageDataUrl(`https://mc-heads.net/body/${encodeURIComponent(ign)}/144`, 4000);
    if (heads) return { dataUrl: heads, ok: true };
    const fallback = await fetchImageDataUrl(`https://nmsr.nickac.dev/fullbody/${encodeURIComponent(ign)}`, 4000);
    if (fallback) return { dataUrl: fallback, ok: true };
    return { dataUrl: null, ok: false };
  });
}
