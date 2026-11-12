import { createCanvas, loadImage, GlobalFonts, SKRSContext2D, Image } from '@napi-rs/canvas';
import path from 'path';
import fs from 'fs';
import { PlayerData, RecentGame, Helpers, RankInfo } from './base';
import { getRankInfo } from '../utils/rankInfo';

export { PlayerData, RecentGame, Helpers, RankInfo };

// ─── Font Registration ───────────────────────────────────────
const FONT_PATHS = {
  Minecraft: path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'Minecraft.otf'),
  ADAMCGPRO: path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'ADAM.CG PRO.otf'),
  PoppinsMedium: path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'Poppins-Medium.ttf'),
  PoppinsRegular: path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'Poppins-Regular.ttf'),
  PoppinsSemiBold: path.resolve(process.cwd(), 'src', 'assets', 'fonts', 'Poppins-SemiBold.ttf'),
};

let fontsRegistered = false;

function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  try {
    for (const [name, fpath] of Object.entries(FONT_PATHS)) {
      if (fs.existsSync(fpath)) {
        GlobalFonts.registerFromPath(fpath, name);
      }
    }
    fontsRegistered = true;
  } catch (e) {
    console.warn('[veltrix] Failed to register fonts:', e);
  }
}

async function fetchSkin(ign: string, type: 'fullbody' | 'face' = 'fullbody'): Promise<Image | null> {
  const urls = type === 'face'
    ? [
        `https://nmsr.nickac.dev/face/${encodeURIComponent(ign)}`,
        `https://mc-heads.net/avatar/${encodeURIComponent(ign)}/64`
      ]
    : [
        `https://nmsr.nickac.dev/fullbody/${encodeURIComponent(ign)}`,
        `https://mc-heads.net/body/${encodeURIComponent(ign)}`
      ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      return await loadImage(buf);
    } catch {
      // try fallback url
    }
  }
  return null;
}

function createShadowFromSkin(skin: Image, w: number, h: number): Image {
  const off = createCanvas(w, h);
  const octx = off.getContext('2d');
  octx.drawImage(skin, 0, 0, w, h);
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 0) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = Math.max(0, Math.min(255, Math.floor(a * 0.4)));
    }
  }
  octx.putImageData(img, 0, 0);
  return off as unknown as Image;
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

function adjustColor(hex: string, percent: number): string {
  try {
    const cleanHex = hex.replace('#', '');
    const num = parseInt(cleanHex, 16);
    if (isNaN(num)) return hex;
    let r = (num >> 16) + Math.round(255 * (percent / 100));
    let g = ((num >> 8) & 0x00FF) + Math.round(255 * (percent / 100));
    let b = (num & 0x0000FF) + Math.round(255 * (percent / 100));
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  } catch {
    return hex;
  }
}

// Draw text with Minecraft-style drop shadow (2px offset, darker color)
function drawMinecraftText(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string
): void {
  ctx.font = font;
  ctx.save();
  ctx.fillStyle = '#1A1A1A';
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const MC_COLOR_MAP: Record<string, string> = {
  '0': '#000000',
  '1': '#0000AA',
  '2': '#00AA00',
  '3': '#00AAAA',
  '4': '#AA0000',
  '5': '#AA00AA',
  '6': '#FFAA00',
  '7': '#AAAAAA',
  '8': '#555555',
  '9': '#5555FF',
  'a': '#55FF55',
  'b': '#55FFFF',
  'c': '#FF5555',
  'd': '#FF55FF',
  'e': '#FFFF55',
  'f': '#FFFFFF',
  'g': '#DDD605',
};

type FormattedSegment = {
  text: string;
  color: string;
};

function parseMinecraftFormatted(raw: string, defaultColor: string = '#AAAAAA'): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  let currentColor = defaultColor;
  let currentText = '';

  for (let i = 0; i < raw.length; i++) {
    if ((raw[i] === '&' || raw[i] === '§') && i + 1 < raw.length) {
      const code = raw[i + 1].toLowerCase();
      if (MC_COLOR_MAP[code]) {
        if (currentText.length > 0) {
          segments.push({ text: currentText, color: currentColor });
          currentText = '';
        }
        currentColor = MC_COLOR_MAP[code];
        i++;
        continue;
      } else if (code === 'r') {
        if (currentText.length > 0) {
          segments.push({ text: currentText, color: currentColor });
          currentText = '';
        }
        currentColor = defaultColor;
        i++;
        continue;
      }
    }
    currentText += raw[i];
  }
  if (currentText.length > 0) {
    segments.push({ text: currentText, color: currentColor });
  }
  return segments;
}

function drawFormattedMinecraftText(
  ctx: SKRSContext2D,
  segments: FormattedSegment[],
  startX: number,
  y: number,
  fontSize: number = 28,
  maxWidth: number = 640
): void {
  ctx.font = `${fontSize}px "Minecraft"`;
  let totalWidth = segments.reduce((sum, seg) => sum + ctx.measureText(seg.text).width, 0);

  while (totalWidth > maxWidth && fontSize > 16) {
    fontSize -= 1;
    ctx.font = `${fontSize}px "Minecraft"`;
    totalWidth = segments.reduce((sum, seg) => sum + ctx.measureText(seg.text).width, 0);
  }

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // 1. Shadows
  let curX = startX;
  ctx.fillStyle = '#1A1A1A';
  for (const seg of segments) {
    ctx.fillText(seg.text, curX + 2, y + 2);
    curX += ctx.measureText(seg.text).width;
  }

  // 2. Foreground text
  curX = startX;
  for (const seg of segments) {
    ctx.fillStyle = seg.color;
    ctx.fillText(seg.text, curX, y);
    curX += ctx.measureText(seg.text).width;
  }

  ctx.restore();
}

// Draw stat text with auto-scaling so it never overrides label text
function drawFittedStat(
  ctx: SKRSContext2D,
  text: string,
  rightX: number,
  y: number,
  color: string,
  maxWidth: number = 85
): void {
  let fontSize = 18;
  ctx.font = `${fontSize}px "Minecraft"`;
  let w = ctx.measureText(text).width;
  while (w > maxWidth && fontSize > 11) {
    fontSize -= 1;
    ctx.font = `${fontSize}px "Minecraft"`;
    w = ctx.measureText(text).width;
  }
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  drawMinecraftText(ctx, text, rightX, y, `${fontSize}px "Minecraft"`, color);
  ctx.restore();
}

// ─── Theme image path ────────────────────────────────────────
function getThemeImagePath(themeName = 'veltrix'): string {
  return path.resolve(process.cwd(), 'src', 'assets', 'themes', `${themeName}.png`);
}

// ═════════════════════════════════════════════════════════════
// Main renderer – loads theme image (1024x585) and renders stats
// ═════════════════════════════════════════════════════════════
export async function generateVeltrixImage(
  playerData: PlayerData,
  recentGames: RecentGame[],
  helpers: Helpers,
  themeName: string = 'veltrix'
): Promise<Buffer> {
  ensureFontsRegistered();

  const theme = await loadImage(getThemeImagePath(themeName));
  const canvas = createCanvas(theme.width, theme.height);
  const ctx = canvas.getContext('2d');

  // Draw background template
  ctx.drawImage(theme, 0, 0);

  // 1. TOP BAR: Player Head & IGN
  try {
    const head = await fetchSkin(playerData.ign, 'face');
    if (head) {
      ctx.save();
      roundedRect(ctx, 34, 27, 34, 34, 4);
      ctx.clip();
      ctx.drawImage(head, 34, 27, 34, 34);
      ctx.restore();
    }
  } catch {
    // Graceful fallback if head fails
  }

  const ign = playerData.ign || 'Player';
  const prime = playerData.primeRank ? String(playerData.primeRank).toLowerCase().trim() : null;

  let rawFormattedIgn = `&7${ign}`;
  if (prime === 'prime++' || prime === 'prime_plus_plus') {
    rawFormattedIgn = `&g[&ePrime&7+&f+&g] &e${ign}`;
  } else if (prime === 'prime+' || prime === 'prime_plus') {
    rawFormattedIgn = `&5[&dPrime&7+&5] &d${ign}`;
  } else if (prime === 'prime') {
    rawFormattedIgn = `&3[&bPrime&3] &b${ign}`;
  }

  const segments = parseMinecraftFormatted(rawFormattedIgn);
  const startFontSize = prime ? 24 : (ign.length <= 12 ? 28 : 22);
  drawFormattedMinecraftText(ctx, segments, 80, 44, startFontSize, 640);

  // 2. Header Box: Current Rank (left), ELO (center), Next Rank (right)
  const rankInfo = playerData.rankInfo || (await getRankInfo(playerData.elo ?? 0));

  const eloVal = (playerData.elo ?? 0).toLocaleString();

  // Left: Current Rank Name in its role color
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  drawMinecraftText(ctx, rankInfo.name, 375, 104, '18px "Minecraft"', rankInfo.color);

  // Center: ELO in gold
  ctx.textAlign = 'center';
  drawMinecraftText(ctx, `${eloVal} ELO`, 682, 104, '18px "Minecraft"', '#FFAA00');

  // Right: Next Rank Name in its role color
  ctx.textAlign = 'right';
  const nextName = rankInfo.isMaxRank ? 'MAX RANK' : (rankInfo.nextRankName || 'MAX RANK');
  const nextCol = rankInfo.isMaxRank ? rankInfo.color : (rankInfo.nextRankColor || rankInfo.color);
  drawMinecraftText(ctx, nextName, 988, 104, '18px "Minecraft"', nextCol);

  // Progress Bar calculation based on EloRank progression
  const startElo = rankInfo.startElo;
  const targetElo = rankInfo.nextRankStartElo || rankInfo.endElo;
  let progressPct: number;

  if (rankInfo.isMaxRank) {
    progressPct = 1.0;
  } else if (targetElo > startElo) {
    const currentInRank = Math.max(0, (playerData.elo ?? 0) - startElo);
    const totalInRank = targetElo - startElo;
    progressPct = Math.min(1, Math.max(0, currentInRank / totalInRank));
  } else {
    progressPct = 1.0;
  }

  // Progress Bar fill with 3D rank-based color grading
  const barX = 375;
  const barY = 123;
  const barW = 612;
  const barH = 14;
  const radius = 7;
  const fillW = Math.max(14, Math.round(barW * progressPct));
  const rankColor = rankInfo.color || '#FFAA00';

  // 1. Clip to recessed track of the template
  ctx.save();
  roundedRect(ctx, barX, barY, barW, barH, radius);
  ctx.clip();

  // Dark unfilled track background
  ctx.fillStyle = 'rgba(12, 17, 32, 0.75)';
  ctx.fillRect(barX, barY, barW, barH);

  // 2. The fill shape (rounded pill)
  ctx.save();
  roundedRect(ctx, barX, barY, fillW, barH, radius);
  ctx.clip();

  // Horizontal gradient: rich rank color -> vibrant rank color
  const fillGrad = ctx.createLinearGradient(barX, barY, barX + fillW, barY);
  fillGrad.addColorStop(0, adjustColor(rankColor, -20));
  fillGrad.addColorStop(0.6, rankColor);
  fillGrad.addColorStop(1, adjustColor(rankColor, 30));
  ctx.fillStyle = fillGrad;
  ctx.fillRect(barX, barY, fillW, barH);

  // Vertical highlight & shadow (glossy cylindrical depth)
  const vertGrad = ctx.createLinearGradient(barX, barY, barX, barY + barH);
  vertGrad.addColorStop(0, 'rgba(255, 255, 255, 0.60)');
  vertGrad.addColorStop(0.25, 'rgba(255, 255, 255, 0.15)');
  vertGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.0)');
  vertGrad.addColorStop(0.75, 'rgba(0, 0, 0, 0.15)');
  vertGrad.addColorStop(1, 'rgba(0, 0, 0, 0.50)');
  ctx.fillStyle = vertGrad;
  ctx.fillRect(barX, barY, fillW, barH);

  // Subtle top rim highlight line
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(barX, barY, fillW, 1);

  // Leading edge highlight (rounded cap sheen)
  if (fillW < barW - 4) {
    const tipGrad = ctx.createRadialGradient(
      barX + fillW - 4, barY + barH / 2, 0,
      barX + fillW - 4, barY + barH / 2, 8
    );
    tipGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    tipGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = tipGrad;
    ctx.fillRect(barX + fillW - 10, barY, 10, barH);
  }

  ctx.restore(); // end fill clip
  ctx.restore(); // end track clip

  // 3. Left Panel: Player Standing Skin & Leaderboard Position
  try {
    const skin = await fetchSkin(playerData.ign, 'fullbody');
    if (skin) {
      const skinH = 270;
      const skinW = Math.round(skinH * (skin.width / skin.height));
      const skinX = Math.round(176 - skinW / 2);
      const skinY = 125;
      const shadow = createShadowFromSkin(skin, skinW, skinH);
      ctx.drawImage(shadow, skinX + 4, skinY + 4);
      ctx.drawImage(skin, skinX, skinY, skinW, skinH);
    }
  } catch {
    // Graceful fallback if skin fails
  }

  // Leaderboard Rank
  let positionValue: string | number;
  try {
    positionValue = await Promise.resolve(helpers.calculatePosition(String(playerData.discordid)));
    if (!positionValue || positionValue === 0) positionValue = 'Unranked';
  } catch {
    positionValue = 'Unranked';
  }

  const rankText = typeof positionValue === 'number' ? `# ${positionValue}` : String(positionValue);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawMinecraftText(ctx, rankText, 176, 448, rankText.length > 6 ? '26px "Minecraft"' : '34px "Minecraft"', '#FFAA00');

  // 4. Middle 3 Cards (Matches, Combat, Honours)
  const rows = [
    { y: 232 },
    { y: 290 },
    { y: 348 },
    { y: 406 },
  ];

  const totalGames = (playerData.gamesplayed ?? 0);
  const totalWins = playerData.wins ?? 0;
  const totalLosses = playerData.losses ?? 0;
  const totalKills = playerData.kills ?? 0;
  const totalDeaths = playerData.deaths ?? 0;
  const totalMvps = playerData.mvps ?? 0;

  const wlNum = totalWins / Math.max(1, totalLosses);
  const kdNum = totalKills / Math.max(1, totalDeaths);
  const kpgNum = totalGames > 0 ? totalKills / totalGames : 0;
  const mvpRateVal = totalGames > 0 ? Math.round((totalMvps / totalGames) * 100) : 0;

  // Card 1: Matches (rightX: 554)
  // Played: White #FFFFFF
  drawFittedStat(ctx, totalGames.toLocaleString(), 554, rows[0].y, '#FFFFFF', 115);
  // Wins: Green #55FF55
  drawFittedStat(ctx, totalWins.toLocaleString(), 554, rows[1].y, '#55FF55', 125);
  // Losses: Red #FF5555
  drawFittedStat(ctx, totalLosses.toLocaleString(), 554, rows[2].y, '#FF5555', 115);
  // W/L: Green if >= 1.0, Yellow if < 1.0
  drawFittedStat(ctx, wlNum.toFixed(2), 554, rows[3].y, wlNum >= 1.0 ? '#55FF55' : '#FFFF55', 125);

  // Card 2: Combat (rightX: 772)
  // Kills: Green #55FF55
  drawFittedStat(ctx, totalKills.toLocaleString(), 772, rows[0].y, '#55FF55', 130);
  // Deaths: Red #FF5555
  drawFittedStat(ctx, totalDeaths.toLocaleString(), 772, rows[1].y, '#FF5555', 120);
  // K/D: Green if >= 1.0, Yellow if < 1.0
  drawFittedStat(ctx, kdNum.toFixed(2), 772, rows[2].y, kdNum >= 1.0 ? '#55FF55' : '#FFFF55', 130);
  // Kills/Game: Gold #FFAA00 (maxWidth 88 ensures it never overrides 'Kills/Game' label)
  drawFittedStat(ctx, kpgNum.toFixed(2), 772, rows[3].y, '#FFAA00', 88);

  // Card 3: Honours (rightX: 992)
  // MVPs: Gold #FFAA00
  drawFittedStat(ctx, totalMvps.toLocaleString(), 992, rows[0].y, '#FFAA00', 130);
  // MVP Rate: Yellow #FFFF55
  drawFittedStat(ctx, `${mvpRateVal}%`, 992, rows[1].y, '#FFFF55', 95);
  // Beds Broken: Red #FF5555
  drawFittedStat(ctx, (playerData.bedBroken ?? 0).toLocaleString(), 992, rows[2].y, '#FF5555', 85);

  // Streak: Gold #FFAA00 or Red if losestreak
  const ws = playerData.winstreak ?? 0;
  const ls = playerData.losestreak ?? 0;
  if (ws > 0) {
    drawFittedStat(ctx, `+${ws}`, 992, rows[3].y, '#FFAA00', 95);
  } else if (ls > 0) {
    drawFittedStat(ctx, `-${ls}`, 992, rows[3].y, '#FF5555', 95);
  } else {
    drawFittedStat(ctx, '0', 992, rows[3].y, '#FFFFFF', 95);
  }

  // 5. Resource Row (Iron, Gold, Diamonds, Emeralds)
  const resFont = '15px "Minecraft"';
  ctx.textAlign = 'left';
  // Iron: White #FFFFFF
  drawMinecraftText(ctx, (playerData.irons ?? 0).toLocaleString(), 438, 471, resFont, '#FFFFFF');
  // Gold: Gold #FFAA00
  drawMinecraftText(ctx, (playerData.gold ?? 0).toLocaleString(), 598, 471, resFont, '#FFAA00');
  // Diamonds: Diamond Cyan #55FFFF
  drawMinecraftText(ctx, (playerData.diamonds ?? 0).toLocaleString(), 746, 471, resFont, '#55FFFF');
  // Emeralds: Emerald Green #55FF55 (Centered directly above 'EMERALDS' written on template)
  ctx.textAlign = 'center';
  drawMinecraftText(ctx, (playerData.emeralds ?? 0).toLocaleString(), 944, 471, resFont, '#55FF55');

  return canvas.toBuffer('image/png');
}

export default {
  generate: (playerData: PlayerData, recentGames: RecentGame[], helpers: Helpers) =>
    generateVeltrixImage(playerData, recentGames, helpers),
};
