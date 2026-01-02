import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D, Image as CanvasImage } from 'canvas';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

type PlayerData = {
  discordid: string;
  ign: string;
  wins: number;
  losses: number;
  mvps: number;
  elo: number;
  gamesplayed?: number;
};

type RecentGame = {
  gameid?: number | string;
  result?: 'win' | 'lose' | 'loss' | 'voided' | 'pending' | 'submitted' | string;
} | null;

type Helpers = {
  calculateRating?: (playerData: PlayerData) => number;
  calculatePosition: (discordId: string) => number | string | Promise<number | string>;
};

const FONT_PATHS = {
  ADAMCGPRO: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'ADAM.CG PRO.otf'),
  PoppinsMedium: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-Medium.ttf'),
  PoppinsRegular: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-Regular.ttf'),
};

const THEME_IMAGE_PATH = path.resolve(process.cwd(), 'src', 'asserts', 'themes', 'rich.png');

let fontsRegistered = false;

function ensureFontsRegistered(): void {
  if (fontsRegistered) return;
  try {
    if (fs.existsSync(FONT_PATHS.ADAMCGPRO)) {
      registerFont(FONT_PATHS.ADAMCGPRO, { family: 'ADAMCGPRO' });
    } else {
      console.warn('[themes/rich] Missing font file:', FONT_PATHS.ADAMCGPRO);
    }
    if (fs.existsSync(FONT_PATHS.PoppinsMedium)) {
      registerFont(FONT_PATHS.PoppinsMedium, { family: 'PoppinsMedium' });
    } else {
      console.warn('[themes/rich] Missing font file:', FONT_PATHS.PoppinsMedium);
    }
    if (fs.existsSync(FONT_PATHS.PoppinsRegular)) {
      registerFont(FONT_PATHS.PoppinsRegular, { family: 'PoppinsRegular' });
    } else {
      console.warn('[themes/rich] Missing font file:', FONT_PATHS.PoppinsRegular);
    }
    fontsRegistered = true;
  } catch (e) {
    console.warn('[themes/rich] Failed to register fonts:', e);
  }
}

async function fetchSkin(ign: string, pose: 'fullbody' | 'avatar' = 'fullbody'): Promise<CanvasImage | null> {
  const url = `https://nmsr.nickac.dev/${pose}/${encodeURIComponent(ign)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal } as any);
    clearTimeout(timeout);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await loadImage(buf);
  } catch {
    return null;
  }
}

function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, centerX: number, centerY: number, font: string, color = '#FFFFFF') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centerX, centerY);
}

function drawLeftText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color = '#FFFFFF') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function mvpRate(player: PlayerData): number {
  const mvps = player.mvps || 0;
  const gamesPlayed = player.gamesplayed || 0;
  if (gamesPlayed <= 0) return 0;
  return (mvps / gamesPlayed) * 100;
}

function wlRatio(player: PlayerData): string {
  const wins = player.wins || 0;
  const losses = player.losses || 0;
  const ratio = wins / Math.max(1, losses);
  return ratio.toFixed(1);
}

function getRecentColor(result?: string): string {
  switch ((result || '').toLowerCase()) {
    case 'win': return '#4CAF50';
    case 'lose':
    case 'loss': return '#F44336';
    case 'voided': return '#FFC107';
    case 'pending': return '#FFC107';
    case 'submitted': return '#FF9800';
    default: return '#777777';
  }
}

function createShadowFromSkin(skin: CanvasImage): CanvasImage {
  const targetWidth = 250;
  const targetHeight = 420;
  const off = createCanvas(targetWidth, targetHeight);
  const octx = off.getContext('2d');
  octx.drawImage(skin, 0, 0, targetWidth, targetHeight);
  const img = octx.getImageData(0, 0, targetWidth, targetHeight);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a > 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.max(0, Math.min(255, Math.floor(a * 0.4)));
    }
  }
  octx.putImageData(img, 0, 0);
  return off as unknown as CanvasImage;
}

export async function generateRichThemeImage(
  playerData: PlayerData,
  recentGames: RecentGame[],
  helpers: Helpers
): Promise<Buffer> {
  ensureFontsRegistered();

  const serverName = process.env.SERVER_NAME || 'ZeroCode';
  const inviteLink = process.env.INVITE_LINK || 'discord.gg/zerocode';

  const theme = await loadImage(THEME_IMAGE_PATH);
  const canvas = createCanvas(theme.width, theme.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(theme, 0, 0);

  const fontLarge = '40px "ADAMCGPRO"';
  const fontMedium = '30px "PoppinsRegular"';
  const fontSmall = '24px "PoppinsRegular"';

  drawCenteredText(ctx, serverName, 640, 40, fontLarge, '#FFFFFF');
  drawCenteredText(ctx, inviteLink, 640, 660, fontSmall, '#FFFFFF');

  const ign = playerData.ign || '';
  const ignFont = (ign.length <= 10) ? '34px "ADAMCGPRO"' : '20px "ADAMCGPRO"';
  drawCenteredText(ctx, ign, 258, 574, ignFont, '#FFFFFF');

  const skin = await fetchSkin(playerData.ign);
  if (skin) {
    const resizedW = 250;
    const resizedH = 420;
    const shadow = createShadowFromSkin(skin);
    ctx.drawImage(shadow, 105 + 15, 110 + 15);
    ctx.drawImage(skin, 105, 110, resizedW, resizedH);
  }

  const u = 28;

  const positionValue = await Promise.resolve(helpers.calculatePosition(String(playerData.discordid)));
  const mainStats: Array<{ text: string; x: number; y: number; font: string }> = [
    { text: String(playerData.wins), x: 517, y: 180 + u, font: '85px "ADAMCGPRO"' },
    { text: `#${positionValue}`, x: 780, y: 180 + u, font: '85px "ADAMCGPRO"' },
    { text: String(playerData.mvps), x: 1047, y: 180 + u, font: '85px "ADAMCGPRO"' },
    { text: String(helpers.calculateRating ? helpers.calculateRating(playerData) : playerData.elo), x: 517, y: 490 + u, font: '85px "ADAMCGPRO"' }
  ];

  for (const s of mainStats) {
    drawCenteredText(ctx, s.text, s.x, s.y, s.font, '#FFFFFF');
  }

  const wl = wlRatio(playerData);
  const rate = `${Math.round(mvpRate(playerData))}%`;
  drawCenteredText(ctx, `${wl} W/L`, 517, 322 + 7, '30px "PoppinsMedium"', '#FFFFFF');
  drawCenteredText(ctx, `${rate} RATE`, 1047, 322 + 7, '30px "PoppinsMedium"', '#FFFFFF');

  const arrowX = 710;
  const arrowY = 315 + 10;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(arrowX - 18, arrowY + 2);
  ctx.lineTo(arrowX - 8, arrowY - 12);
  ctx.lineTo(arrowX + 2, arrowY + 2);
  ctx.closePath();
  ctx.fill();
  drawCenteredText(ctx, 'MAX RANK', 795, 315 + 7, '30px "PoppinsMedium"', '#FFFFFF');

  const padded: RecentGame[] = [...recentGames];
  while (padded.length < 10) padded.push(null);
  const games = padded.slice(0, 10);

  const recentYStart = 455;
  const leftX = 730;
  const rightX = 975;
  for (let i = 0; i < 5; i++) {
    const g = games[i];
    const idText = g ? `Game #${g.gameid ?? 'N/A'}` : 'No Game';
    const color = getRecentColor(g?.result);
    drawLeftText(ctx, idText, leftX, recentYStart + i * 28, fontSmall, color);
  }
  for (let i = 0; i < 5; i++) {
    const g = games[5 + i];
    const idText = g ? `Game #${g.gameid ?? 'N/A'}` : 'No Game';
    const color = getRecentColor(g?.result);
    drawLeftText(ctx, idText, rightX, recentYStart + i * 28, fontSmall, color);
  }

  return canvas.toBuffer('image/png');
}

export default {
  generate: generateRichThemeImage,
};