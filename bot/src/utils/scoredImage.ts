import { Canvas, createCanvas, loadImage, GlobalFonts, SKRSContext2D, Image } from '@napi-rs/canvas';
import path from 'path';
import fs from 'fs';

export type PlayerLine = {
  discordId?: string;
  username: string;
  team: 'winning' | 'losing';
  oldElo: number;
  newElo: number;
  mvp?: boolean;
  bedBreaker?: boolean;
  kills?: number;
  deaths?: number;
  diamonds?: number | [number, number];
  kdr?: string | number;
  rating?: number;
  rankIconUrl?: string | null;
  rankName?: string;
  rankColor?: string | [number, number, number];
};

export interface ScoreGameMetadata {
  map?: string;
  duration?: string;
  date?: string;
  winnerTeamElo?: string | number;
  loserTeamElo?: string | number;
  gameId?: string | number;
  mvps?: string[];
  bedBreakers?: string[];
  // 'partial': losers were refunded (their ELO shows a greyed-out +0)
  // 'full': every ELO change was reversed (both teams show a greyed-out +0)
  voided?: 'partial' | 'full';
}

// Colour for ELO changes that were reversed by a void
const VOIDED_ELO_COLOR = '#8C8C8C';

export const RANKS = [
  { name: 'Coal', min: 0, color: [160, 160, 160] as [number, number, number] },
  { name: 'Iron', min: 200, color: [200, 210, 215] as [number, number, number] },
  { name: 'Gold', min: 400, color: [255, 215, 0] as [number, number, number] },
  { name: 'Diamond', min: 600, color: [85, 235, 235] as [number, number, number] },
  { name: 'Emerald', min: 800, color: [85, 255, 85] as [number, number, number] },
  { name: 'Sapphire', min: 1000, color: [60, 130, 240] as [number, number, number] },
  { name: 'Ruby', min: 1200, color: [230, 40, 75] as [number, number, number] },
  { name: 'Amethyst', min: 1400, color: [180, 80, 255] as [number, number, number] },
  { name: 'Opal', min: 1600, color: [240, 180, 220] as [number, number, number] },
  { name: 'Obsidian', min: 1800, color: [130, 40, 200] as [number, number, number] },
  { name: 'Elite', min: 2000, color: [255, 100, 255] as [number, number, number] },
];

export function rankFor(rating: number) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (rating >= RANKS[i].min) return RANKS[i];
  }
  return RANKS[0];
}

const FONT_PATH = path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'Minecraft.otf');
const TEMPLATE_PATH = path.resolve(process.cwd(), 'src', 'assets', 'games', 'scored.png');
const RANKS_CACHE_DIR = path.resolve(process.cwd(), 'src', 'assets', 'ranks');
const FALLBACK_AVATAR = path.resolve(process.cwd(), 'src', 'assets', 'fallbacks', 'steve.png');

let fontsRegistered = false;
let cachedTemplate: Image | null = null;
let cachedSteve: Image | null = null;

function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  try {
    if (fs.existsSync(FONT_PATH)) {
      GlobalFonts.registerFromPath(FONT_PATH, 'Minecraft');
      fontsRegistered = true;
    }
  } catch (e) {
    console.warn('[scoreImage] Font registration failed:', e);
  }
}

async function loadStaticImages(): Promise<void> {
  if (!cachedTemplate) {
    cachedTemplate = await loadImage(TEMPLATE_PATH);
  }
  if (!cachedSteve && fs.existsSync(FALLBACK_AVATAR)) {
    try {
      cachedSteve = await loadImage(FALLBACK_AVATAR);
    } catch {
      // ignore
    }
  }
}

interface PixelIcon {
  grid: string[];
  pal: Record<string, [number, number, number]>;
}

const gemCache = new Map<string, PixelIcon>();
function gem(c: [number, number, number]): PixelIcon {
  const key = c.join(',');
  let g = gemCache.get(key);
  if (!g) {
    g = {
      grid: [
        '..hhhh..',
        '.hllllh.',
        'hllwllld',
        'dllllldd',
        '.dlllld.',
        '..dlld..',
        '...dd...',
        '........'
      ],
      pal: {
        h: c.map((v) => Math.min(255, v + 70)) as [number, number, number],
        l: c,
        d: c.map((v) => Math.floor(v * 0.55)) as [number, number, number],
        w: [255, 255, 255]
      }
    };
    gemCache.set(key, g);
  }
  return g;
}

const iconCanvasCache = new Map<PixelIcon, Canvas>();
function iconCanvas(ic: PixelIcon) {
  const hit = iconCanvasCache.get(ic);
  if (hit) return hit;
  let minX = 99, minY = 99, maxX = -1, maxY = -1;
  ic.grid.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }));
  const c = createCanvas(maxX - minX + 1, maxY - minY + 1);
  const g = c.getContext('2d');
  ic.grid.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') {
      const col = ic.pal[ch];
      g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
      g.fillRect(x - minX, y - minY, 1, 1);
    }
  }));
  iconCanvasCache.set(ic, c);
  return c;
}

function drawPixelIcon(ctx: SKRSContext2D, ic: PixelIcon, x: number, cy: number, size = 11): void {
  const c = iconCanvas(ic);
  const k = size / Math.max(c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, Math.round(x), Math.round(cy - (c.height * k) / 2), Math.round(c.width * k), Math.round(c.height * k));
  ctx.imageSmoothingEnabled = true;
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
  ctx.fillText(text, x + 1.5, y + 1.5);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function fitSize(ctx: SKRSContext2D, text: string, baseSize: number, maxW: number, minSize = 10): number {
  let size = baseSize;
  ctx.font = `${size}px Minecraft`;
  while (size > minSize && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${size}px Minecraft`;
  }
  return size;
}

function roundedRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arcTo(x + width, y, x + width, y + radius, radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  ctx.lineTo(x + radius, y + height);
  ctx.arcTo(x, y + height, x, y + height - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function drawAvatarBox(
  ctx: SKRSContext2D,
  img: Image,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 3
): void {
  ctx.save();
  roundedRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

const headCache = new Map<string, { at: number; img: Image }>();

async function loadAvatar(username: string): Promise<Image> {
  const cached = headCache.get(username);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
    return cached.img;
  }

  const urls = [
    `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`,
    `https://nmsr.nickac.dev/face/${encodeURIComponent(username)}`,
    `https://minotar.net/avatar/${encodeURIComponent(username)}/64`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const img = await loadImage(buf);
        headCache.set(username, { at: Date.now(), img });
        return img;
      }
    } catch {
      // try next
    }
  }

  if (cachedSteve) {
    return cachedSteve;
  }
  const dummy = createCanvas(36, 35);
  const dg = dummy.getContext('2d');
  dg.fillStyle = '#604025';
  dg.fillRect(0, 0, 36, 35);
  return dummy as unknown as Image;
}

const rankIconImgCache = new Map<string, { at: number; img: Image }>();

export async function loadRankIconImage(roleIdOrUrl?: string | null, iconUrl?: string | null): Promise<Image | null> {
  if (!roleIdOrUrl && !iconUrl) return null;
  const key = iconUrl || roleIdOrUrl!;
  const cached = rankIconImgCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) {
    return cached.img;
  }

  // 1. Check if direct file path exists
  for (const candidate of [iconUrl, roleIdOrUrl]) {
    if (candidate && fs.existsSync(candidate)) {
      try {
        const img = await loadImage(candidate);
        rankIconImgCache.set(key, { at: Date.now(), img });
        return img;
      } catch {}
    }
  }

  // 2. Check local file in ranks cache directory by roleId or identifier
  if (roleIdOrUrl && !roleIdOrUrl.startsWith('http')) {
    const localPath = path.join(RANKS_CACHE_DIR, `${roleIdOrUrl}.png`);
    if (fs.existsSync(localPath)) {
      try {
        const img = await loadImage(localPath);
        rankIconImgCache.set(key, { at: Date.now(), img });
        return img;
      } catch {}
    }
  }

  // 3. Fetch via URL
  const fetchUrl = (iconUrl && iconUrl.startsWith('http')) ? iconUrl : (roleIdOrUrl && roleIdOrUrl.startsWith('http') ? roleIdOrUrl : null);
  if (fetchUrl) {
    try {
      const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const img = await loadImage(buf);
        rankIconImgCache.set(key, { at: Date.now(), img });

        if (roleIdOrUrl && !roleIdOrUrl.startsWith('http')) {
          if (!fs.existsSync(RANKS_CACHE_DIR)) fs.mkdirSync(RANKS_CACHE_DIR, { recursive: true });
          fs.promises.writeFile(path.join(RANKS_CACHE_DIR, `${roleIdOrUrl}.png`), buf).catch(() => {});
        }
        return img;
      }
    } catch {}
  }

  return null;
}

interface ResolvedPlayerRank {
  name: string;
  colorStr: string;
  colorRgb: [number, number, number];
  iconImg: Image | null;
}

async function resolvePlayerRank(p: PlayerLine): Promise<ResolvedPlayerRank> {
  const rating = p.rating ?? p.newElo;
  const fallback = rankFor(rating);
  const rankName = p.rankName || fallback.name;
  const colorStr = typeof p.rankColor === 'string' ? p.rankColor : `rgb(${fallback.color[0]},${fallback.color[1]},${fallback.color[2]})`;
  const colorRgb: [number, number, number] = Array.isArray(p.rankColor) ? p.rankColor : fallback.color;
  let iconImg: Image | null = null;

  if (p.rankIconUrl) {
    iconImg = await loadRankIconImage(null, p.rankIconUrl);
  }

  return {
    name: rankName,
    colorStr,
    colorRgb,
    iconImg
  };
}

export async function generateScoredImage(
  gameId: number,
  winners: PlayerLine[],
  losers: PlayerLine[],
  metadata?: ScoreGameMetadata
): Promise<Buffer> {
  ensureFontsRegistered();
  await loadStaticImages();

  if (!cachedTemplate) throw new Error('Scored background template not loaded');
  const template = cachedTemplate;

  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');

  // Draw the base template
  ctx.drawImage(template, 0, 0);

  // 1. Game Details (Top Right) - aligned next to labels
  const mapStr = metadata?.map && metadata.map !== 'Unknown' ? metadata.map : 'Speedway';
  const gameIdStr = `#${gameId}`;
  const durationStr = metadata?.duration || 'N/A';
  const dateStr = metadata?.date || new Date().toLocaleDateString('en-GB');

  mcText(ctx, mapStr, 970, 120, 14, '#FFFFFF', 'right');
  mcText(ctx, gameIdStr, 970, 151, 14, '#FFFFFF', 'right');
  mcText(ctx, durationStr, 970, 181, 14, '#FFFFFF', 'right');
  mcText(ctx, dateStr, 970, 212, 14, '#FFFFFF', 'right');

  const winnersVoided = metadata?.voided === 'full';
  const losersVoided = metadata?.voided === 'full' || metadata?.voided === 'partial';

  // 2. Team ELO (Top Left - Victory)
  let winText: string;
  if (winnersVoided) {
    winText = '+0';
  } else if (metadata?.winnerTeamElo !== undefined) {
    winText = String(metadata.winnerTeamElo);
  } else {
    const totalWinElo = winners.reduce((s, p) => s + (p.newElo - p.oldElo), 0);
    winText = `${totalWinElo >= 0 ? '+' : ''}${totalWinElo}`;
  }
  mcText(ctx, winText, 137, 88, 14, winnersVoided ? VOIDED_ELO_COLOR : '#55FF55', 'left');

  // 3. Team ELO (Bottom Right - Defeat)
  let loseText: string;
  if (losersVoided) {
    loseText = '+0';
  } else if (metadata?.loserTeamElo !== undefined) {
    loseText = String(metadata.loserTeamElo);
  } else {
    const totalLoseElo = losers.reduce((s, p) => s + (p.newElo - p.oldElo), 0);
    loseText = `${totalLoseElo}`;
  }
  ctx.fillStyle = 'rgb(12, 20, 30)';
  ctx.fillRect(820, 495, 168, 20);
  ctx.font = '14px Minecraft';
  const teamEloLabel = 'TEAM ELO ';
  const labelW = ctx.measureText(teamEloLabel).width;
  const numW = ctx.measureText(loseText).width;
  const teamEloStartX = 970 - (labelW + numW);
  mcText(ctx, teamEloLabel, teamEloStartX, 507, 14, '#C8C8C8', 'left');
  mcText(ctx, loseText, teamEloStartX + labelW, 507, 14, losersVoided ? VOIDED_ELO_COLOR : '#FF5555', 'left');

  // 4. Winners (Left Side Slots 0..3)
  for (let i = 0; i < Math.min(4, winners.length); i++) {
    const p = winners[i];
    const yBox = 110 + i * 54;
    const cy = 140.5 + i * 54;

    // Avatar in box (42, yBox, 38, 38)
    try {
      const avatar = await loadAvatar(p.username);
      drawAvatarBox(ctx, avatar, 42, yBox, 38, 38, 3);
    } catch {
      if (cachedSteve) drawAvatarBox(ctx, cachedSteve, 42, yBox, 38, 38, 3);
    }

    // Line 1: Player Name in white
    const nameSize = fitSize(ctx, p.username, 16, 220);
    mcText(ctx, p.username, 92, yBox + 10, nameSize, '#FFFFFF', 'left');

    // Line 2: Rank Icon + Rank Name
    const resolvedRank = await resolvePlayerRank(p);
    if (resolvedRank.iconImg) {
      const iconSize = 13;
      ctx.drawImage(resolvedRank.iconImg, 91, Math.round(cy - iconSize / 2), iconSize, iconSize);
    } else {
      drawPixelIcon(ctx, gem(resolvedRank.colorRgb), 92, cy, 11);
    }
    mcText(ctx, resolvedRank.name.toUpperCase(), 107, cy, 12, resolvedRank.colorStr, 'left');

    // Line 2: Sword kills (template sword icon ends at 200)
    const kills = p.kills ?? 0;
    mcText(ctx, String(kills), 205, cy, 12, '#FFFFFF', 'left');

    // Line 2: KDR (template 'KDR' is at 274..297, value right-aligned before it at 270)
    let kdrVal: number;
    if (typeof p.kdr === 'number') {
      kdrVal = p.kdr;
    } else if (typeof p.kdr === 'string' && !isNaN(Number(p.kdr))) {
      kdrVal = Number(p.kdr);
    } else {
      const d = p.deaths ?? 0;
      kdrVal = d > 0 ? kills / d : kills;
    }
    const kdrStr = kdrVal.toFixed(2);
    const kdrCol = kdrVal >= 1.0 ? '#55FF55' : '#FF5555';
    mcText(ctx, kdrStr, 270, cy, 12, kdrCol, 'right');

    // Line 2: Diamonds (template diamond icon is at 317..325)
    let ownDiamonds = 0;
    let enemyDiamonds = 0;
    if (Array.isArray(p.diamonds)) {
      ownDiamonds = p.diamonds[0] ?? 0;
      enemyDiamonds = p.diamonds[1] ?? 0;
    } else if (typeof p.diamonds === 'number') {
      ownDiamonds = p.diamonds;
      const otherDiamonds = losers.reduce((s, op) => s + (Array.isArray(op.diamonds) ? op.diamonds[0] : (op.diamonds ?? 0)), 0);
      enemyDiamonds = Math.round(otherDiamonds / Math.max(1, losers.length));
    }
    ctx.font = '13px Minecraft';
    let curX = 328;
    mcText(ctx, String(ownDiamonds), curX, cy, 13, '#55FFFF', 'left');
    curX += ctx.measureText(String(ownDiamonds)).width;
    mcText(ctx, '/', curX, cy, 13, '#AAAAAA', 'left');
    curX += ctx.measureText('/').width;
    mcText(ctx, String(enemyDiamonds), curX, cy, 13, '#C8C8C8', 'left');

    // Right of row: ELO change parallel to diagonal line
    const diff = p.newElo - p.oldElo;
    const diffStr = winnersVoided ? '+0' : (diff >= 0 ? '+' : '') + diff;
    const eloX = 510 - i * 17.5;
    mcText(ctx, diffStr, Math.round(eloX), 128 + i * 54, 22, winnersVoided ? VOIDED_ELO_COLOR : '#55FF55', 'right');
  }

  // 5. Losers (Right Side Slots 0..3) - Template order: Diamond -> KDR -> Sword
  for (let i = 0; i < Math.min(4, losers.length); i++) {
    const p = losers[i];
    const yBox = 267 + i * 54;
    const cy = 298 + i * 54;

    // 1) Left of row: ELO change parallel to diagonal line
    const diff = p.newElo - p.oldElo;
    const diffStr = losersVoided ? '+0' : String(diff);
    const eloX = 565 - i * 17.5;
    mcText(ctx, diffStr, Math.round(eloX), 286 + i * 54, 22, losersVoided ? VOIDED_ELO_COLOR : '#FF5555', 'left');

    // 2) Diamond count (template diamond icon is at 633..641)
    let ownDiamonds = 0;
    let enemyDiamonds = 0;
    if (Array.isArray(p.diamonds)) {
      ownDiamonds = p.diamonds[0] ?? 0;
      enemyDiamonds = p.diamonds[1] ?? 0;
    } else if (typeof p.diamonds === 'number') {
      ownDiamonds = p.diamonds;
      const otherDiamonds = winners.reduce((s, op) => s + (Array.isArray(op.diamonds) ? op.diamonds[0] : (op.diamonds ?? 0)), 0);
      enemyDiamonds = Math.round(otherDiamonds / Math.max(1, winners.length));
    }
    ctx.font = '13px Minecraft';
    let curX = 645;
    mcText(ctx, String(ownDiamonds), curX, cy, 13, '#55FFFF', 'left');
    curX += ctx.measureText(String(ownDiamonds)).width;
    mcText(ctx, '/', curX, cy, 13, '#AAAAAA', 'left');
    curX += ctx.measureText('/').width;
    mcText(ctx, String(enemyDiamonds), curX, cy, 13, '#C8C8C8', 'left');

    // 3) KDR value (template 'KDR' is at 762..788, value right-aligned before it at 757)
    const kills = p.kills ?? 0;
    let kdrVal: number;
    if (typeof p.kdr === 'number') {
      kdrVal = p.kdr;
    } else if (typeof p.kdr === 'string' && !isNaN(Number(p.kdr))) {
      kdrVal = Number(p.kdr);
    } else {
      const d = p.deaths ?? 0;
      kdrVal = d > 0 ? kills / d : kills;
    }
    const kdrStr = kdrVal.toFixed(2);
    const kdrCol = kdrVal >= 1.0 ? '#55FF55' : '#FF5555';
    mcText(ctx, kdrStr, 757, cy, 12, kdrCol, 'right');

    // 4) Sword kills (template sword icon is at 805..814, kills right after it at 818)
    mcText(ctx, String(kills), 818, cy, 12, '#FFFFFF', 'left');

    // 5) Rank Icon + Rank Name (placed cleanly after sword kills at 840)
    const resolvedRank = await resolvePlayerRank(p);
    if (resolvedRank.iconImg) {
      const iconSize = 13;
      ctx.drawImage(resolvedRank.iconImg, 839, Math.round(cy - iconSize / 2), iconSize, iconSize);
    } else {
      drawPixelIcon(ctx, gem(resolvedRank.colorRgb), 840, cy, 11);
    }
    mcText(ctx, resolvedRank.name.toUpperCase(), 855, cy, 12, resolvedRank.colorStr, 'left');

    // 6) Player Name (right-aligned to 930) in white
    const nameSize = fitSize(ctx, p.username, 16, 125);
    mcText(ctx, p.username, 930, yBox + 10, nameSize, '#FFFFFF', 'right');

    // 7) Avatar in right box (945, yBox, 38, 38)
    try {
      const avatar = await loadAvatar(p.username);
      drawAvatarBox(ctx, avatar, 945, yBox, 38, 38, 3);
    } catch {
      if (cachedSteve) drawAvatarBox(ctx, cachedSteve, 945, yBox, 38, 38, 3);
    }
  }

  // 6. MVPs (Bottom Left: 43, bottomBoxYs[m], 22, 22)
  const bottomBoxYs = [376, 405, 435];
  const mvpNames = [...new Set(Array.isArray(metadata?.mvps) && metadata.mvps.length > 0
    ? metadata.mvps
    : [...winners, ...losers].filter(p => p.mvp).map(p => p.username))];

  if (mvpNames.length > 0) {
    for (let m = 0; m < Math.min(3, mvpNames.length); m++) {
      const name = mvpNames[m];
      const yAv = bottomBoxYs[m];
      try {
        const avatar = await loadAvatar(name);
        drawAvatarBox(ctx, avatar, 43, yAv, 22, 22, 2);
      } catch {
        if (cachedSteve) drawAvatarBox(ctx, cachedSteve, 43, yAv, 22, 22, 2);
      }
      const mvpSize = fitSize(ctx, name, 14, 150);
      mcText(ctx, name, 72, yAv + 11, mvpSize, '#FFFFFF', 'left');
    }
  } else {
    if (cachedSteve) drawAvatarBox(ctx, cachedSteve, 43, bottomBoxYs[0], 22, 22, 2);
    mcText(ctx, 'None', 72, bottomBoxYs[0] + 11, 14, '#777777', 'left');
  }

  // 7. Bed Breakers (Bottom Left: 233, bottomBoxYs[b], 22, 22)
  const bbNames = [...new Set(Array.isArray(metadata?.bedBreakers) && metadata.bedBreakers.length > 0
    ? metadata.bedBreakers
    : [...winners, ...losers].filter(p => p.bedBreaker).map(p => p.username))];

  if (bbNames.length > 0) {
    for (let b = 0; b < Math.min(3, bbNames.length); b++) {
      const name = bbNames[b];
      const yAv = bottomBoxYs[b];
      try {
        const av = await loadAvatar(name);
        drawAvatarBox(ctx, av, 233, yAv, 22, 22, 2);
      } catch {
        if (cachedSteve) drawAvatarBox(ctx, cachedSteve, 233, yAv, 22, 22, 2);
      }
      const bbSize = fitSize(ctx, name, 14, 150);
      mcText(ctx, name, 262, yAv + 11, bbSize, '#FFFFFF', 'left');
    }
  } else {
    if (cachedSteve) drawAvatarBox(ctx, cachedSteve, 233, bottomBoxYs[0], 22, 22, 2);
    mcText(ctx, 'None', 262, bottomBoxYs[0] + 11, 14, '#777777', 'left');
  }

  return canvas.toBuffer('image/png');
}
