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
    const res = await fetch(url, { signal: controller.signal } as any);
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

export async function loadAvatarDataUrl(username: string): Promise<string> {
  const remote = await fetchImageDataUrl(`https://mineskin.eu/avatar/${encodeURIComponent(username)}/40`, 2000);
  if (remote) return remote;
  return staticImageDataUrl('fallbacks', 'steve.png');
}

export async function loadSkinDataUrl(ign: string): Promise<string | null> {
  return fetchImageDataUrl(`https://nmsr.nickac.dev/fullbody/${encodeURIComponent(ign)}`, 4000);
}
