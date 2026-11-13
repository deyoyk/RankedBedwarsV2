import { createCanvas, loadImage, GlobalFonts, SKRSContext2D, Image } from '@napi-rs/canvas';
import path from 'path';
import { existsSync } from 'fs';
import axios from 'axios';

const fontPath = path.join(process.cwd(), 'src/assets/fonts/Minecraft.otf');
if (existsSync(fontPath)) {
  try {
    GlobalFonts.registerFromPath(fontPath, 'Minecraft');
  } catch {}
}

let cachedSteve: Image | null = null;
const stevePath = path.join(process.cwd(), 'src/assets/fallbacks/steve.png');
if (existsSync(stevePath)) {
  loadImage(stevePath).then(img => { cachedSteve = img; }).catch(() => {});
}

const headCache = new Map<string, { at: number; img: Image }>();

async function loadAvatar(ign: string): Promise<Image> {
  const cached = headCache.get(ign.toLowerCase());
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
    return cached.img;
  }

  const urls = [
    `https://mc-heads.net/avatar/${encodeURIComponent(ign)}/64`,
    `https://nmsr.nickac.dev/face/${encodeURIComponent(ign)}`,
    `https://minotar.net/helm/${encodeURIComponent(ign)}/32.png`,
  ];

  for (const url of urls) {
    try {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 2500 });
      if (res.status === 200 && res.data) {
        const img = await loadImage(Buffer.from(res.data));
        headCache.set(ign.toLowerCase(), { at: Date.now(), img });
        return img;
      }
    } catch {}
  }

  if (cachedSteve) return cachedSteve;
  throw new Error('Avatar not found');
}

function drawAvatarBox(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number, r = 2): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

function mcText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left'
): void {
  ctx.font = `${size}px Minecraft`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.fillStyle = '#0a0a0a';
  ctx.fillText(text, x + 1.2, y + 1.2);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function fitSize(ctx: SKRSContext2D, text: string, baseSize: number, maxW: number, minSize = 9): number {
  let size = baseSize;
  ctx.font = `${size}px Minecraft`;
  while (size > minSize && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${size}px Minecraft`;
  }
  return size;
}

export interface LeaderboardEntry {
  rank: number;
  ign: string;
  value: string | number;
  elo?: number;
}

export async function generateLeaderboardImage(
  title: string,
  categoryLabel: string,
  entries: LeaderboardEntry[],
  page = 0,
  totalPages?: number
): Promise<Buffer> {
  const isFirstPage = page === 0 && (!entries[0] || entries[0].rank <= 10);
  const templateFileName = isFirstPage ? 'leaderboard.png' : 'leaderboard_page.png';
  const templatePath = path.join(process.cwd(), 'src/assets/games', templateFileName);
  const template = await loadImage(templatePath);
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(template, 0, 0);

  const upperTitle = title.toUpperCase();
  const headerText = isFirstPage
    ? upperTitle
    : (totalPages && totalPages > 1 ? `${upperTitle} - PAGE ${page + 1}/${totalPages}` : `${upperTitle} - PAGE ${page + 1}`);
  const titleSize = fitSize(ctx, headerText, 13, 250);
  mcText(ctx, headerText, 342, 27, titleSize, '#FFFFFF', 'right');

  const avatarResults = await Promise.allSettled(
    entries.slice(0, 10).map(e => loadAvatar(e.ign))
  );

  if (isFirstPage) {
    if (categoryLabel) {
      mcText(ctx, categoryLabel.toUpperCase(), 332, 136, 9, '#AAAAAA', 'right');
    }

    if (entries.length > 0) {
      const e = entries[0];
      const rankNum = e.rank ?? (page * 10 + 1);

      mcText(ctx, `#${rankNum}`, 42, 122, 14, '#FFD700', 'center');

      const avRes = avatarResults[0];
      const avImg = avRes && avRes.status === 'fulfilled' ? avRes.value : cachedSteve;
      if (avImg) {
        drawAvatarBox(ctx, avImg, 61, 104, 36, 36, 3);
      }

      const nameSize = fitSize(ctx, e.ign, 15, 145);
      mcText(ctx, e.ign, 108, 122, nameSize, '#FFFFFF', 'left');

      const valStr = typeof e.value === 'number' ? e.value.toLocaleString() : String(e.value);
      const valSize = fitSize(ctx, valStr, 15, 75);
      mcText(ctx, valStr, 332, 117, valSize, '#55FF55', 'right');
    }

    const rowStartCy = 179;
    const rowSpacing = 35;

    for (let i = 1; i < Math.min(10, entries.length); i++) {
      const e = entries[i];
      const cy = rowStartCy + (i - 1) * rowSpacing;
      const rankNum = e.rank ?? (page * 10 + i + 1);

      const rankColor = rankNum === 2 ? '#E0E0E0' : rankNum === 3 ? '#CD7F32' : '#888888';

      mcText(ctx, `#${rankNum}`, 45, cy, 12, rankColor, 'center');

      const avRes = avatarResults[i];
      const avImg = avRes && avRes.status === 'fulfilled' ? avRes.value : cachedSteve;
      if (avImg) {
        drawAvatarBox(ctx, avImg, 67, Math.round(cy - 10), 20, 20, 2);
      }

      const nameSize = fitSize(ctx, e.ign, 13, 145);
      mcText(ctx, e.ign, 95, cy, nameSize, '#FFFFFF', 'left');

      const valStr = typeof e.value === 'number' ? e.value.toLocaleString() : String(e.value);
      const valSize = fitSize(ctx, valStr, 13, 75);
      mcText(ctx, valStr, 332, cy, valSize, '#FFFFFF', 'right');
    }
  } else {
    const rowCenters = [116, 154, 193, 231, 270, 308, 347, 385, 423, 462];

    for (let i = 0; i < Math.min(10, entries.length); i++) {
      const e = entries[i];
      const cy = rowCenters[i];
      const rankNum = e.rank ?? (page * 10 + i + 1);

      const rankStr = `#${rankNum}`;
      const rankSize = fitSize(ctx, rankStr, 12, 36, 8);
      mcText(ctx, rankStr, 45, cy, rankSize, '#888888', 'center');

      const avRes = avatarResults[i];
      const avImg = avRes && avRes.status === 'fulfilled' ? avRes.value : cachedSteve;
      if (avImg) {
        drawAvatarBox(ctx, avImg, 67, Math.round(cy - 10), 20, 20, 2);
      }

      const nameSize = fitSize(ctx, e.ign, 13, 145);
      mcText(ctx, e.ign, 95, cy, nameSize, '#FFFFFF', 'left');

      const valStr = typeof e.value === 'number' ? e.value.toLocaleString() : String(e.value);
      const valSize = fitSize(ctx, valStr, 13, 75);
      mcText(ctx, valStr, 332, cy, valSize, '#FFFFFF', 'right');
    }
  }

  return canvas.toBuffer('image/png');
}
