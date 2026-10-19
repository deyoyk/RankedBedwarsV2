import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D, Image as CanvasImage } from 'canvas';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

type PlayerLine = {
  discordId: string;
  username: string;
  team: 'winning' | 'losing';
  oldElo: number;
  newElo: number;
  mvp: boolean;
};

const FONT_PATHS = {
  PoppinsLight: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-ExtraLight.ttf'),
  PoppinsSemiBold: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-SemiBold.ttf'),
  PoppinsMedium: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-Medium.ttf'),
  ADAMCGPRO: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'ADAM.CG PRO.otf'),
  PoppinsRegular: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-Regular.ttf')
};

const IMAGE_PATHS = {
  bg: path.resolve(process.cwd(), 'src', 'asserts', 'games', 'scored.png'),
  mvp: path.resolve(process.cwd(), 'src', 'asserts', 'games', 'mvp.png'),
  fallbackAvatar: path.resolve(process.cwd(), 'src', 'asserts', 'fallbacks', 'steve.png')
};

let cachedBg: CanvasImage | null = null;
let cachedMvp: CanvasImage | null = null;

function ensureFontsRegistered(): void {
  try {

    if (fs.existsSync(FONT_PATHS.PoppinsLight)) registerFont(FONT_PATHS.PoppinsLight, { family: 'PoppinsLight' });
    if (fs.existsSync(FONT_PATHS.PoppinsSemiBold)) registerFont(FONT_PATHS.PoppinsSemiBold, { family: 'PoppinsSemiBold' });
    if (fs.existsSync(FONT_PATHS.PoppinsMedium)) registerFont(FONT_PATHS.PoppinsMedium, { family: 'PoppinsMedium' });
    if (fs.existsSync(FONT_PATHS.ADAMCGPRO)) registerFont(FONT_PATHS.ADAMCGPRO, { family: 'ADAMCGPRO' });
    if (fs.existsSync(FONT_PATHS.PoppinsRegular)) registerFont(FONT_PATHS.PoppinsRegular, { family: 'PoppinsRegular' });
  } catch (e) {

    console.warn('[scoreImage] Font registration failed:', e);
  }
}

async function loadStaticImages(): Promise<void> {
  if (!cachedBg) {
    cachedBg = await loadImage(IMAGE_PATHS.bg);
  }
  if (!cachedMvp) {
    cachedMvp = await loadImage(IMAGE_PATHS.mvp);
  }
}

async function loadAvatar(username: string): Promise<CanvasImage> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://mineskin.eu/avatar/${encodeURIComponent(username)}/40`, { signal: controller.signal } as any);
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return await loadImage(buf);
  } catch {
    return await loadImage(IMAGE_PATHS.fallbackAvatar);
  }
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, fillStyle: string, align: CanvasTextAlign = 'left') {
  ctx.font = font;
  ctx.fillStyle = fillStyle;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function measureTextWidth(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  ctx.font = font;
  return ctx.measureText(text).width;
}

export async function generateScoreImageBuffer(
  gameId: number,
  winners: PlayerLine[],
  losers: PlayerLine[],
  options?: { serverName?: string; inviteLink?: string }
): Promise<Buffer> {
  ensureFontsRegistered();
  await loadStaticImages();

  if (!cachedBg) throw new Error('Background image not loaded');
  const bg = cachedBg as CanvasImage;

  const canvas = createCanvas(bg.width, bg.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bg, 0, 0);

  const headerFont = '54px PoppinsLight';
  const smallLight = '54px PoppinsLight';
  const nameFont = '40px ADAMCGPRO';
  const eloFont = '40px ADAMCGPRO';

  drawText(ctx, `GAME #${gameId}`, 120, 45, headerFont, '#757474', 'left');

  const serverName = options?.serverName || process.env.SERVER_NAME || '';
  const inviteLink = options?.inviteLink || process.env.INVITE_LINK || '';

  if (serverName) {
    drawText(ctx, serverName, 120, 952, smallLight, '#757474', 'left');
  }

  if (inviteLink) {
    const inviteWidth = measureTextWidth(ctx, inviteLink, smallLight);
    const targetCenterX = 1612;
    let adjustedX = targetCenterX - inviteWidth / 2;
    if (adjustedX + inviteWidth > canvas.width) {
      adjustedX = canvas.width - inviteWidth - 1;
    }
    drawText(ctx, inviteLink, adjustedX, 952, smallLight, '#757474', 'left');
  }

  await drawTeamCard(ctx, 185, 170, winners, nameFont, eloFont);
  await drawTeamCard(ctx, 185, 600, losers, nameFont, eloFont);

  return canvas.toBuffer('image/png');
}

async function drawTeamCard(
  ctx: CanvasRenderingContext2D,
  posX: number,
  posY: number,
  team: PlayerLine[],
  nameFont: string,
  eloFont: string
): Promise<void> {
  const lineHeight = 93;
  for (let i = 0; i < team.length; i++) {
    const y = posY + i * lineHeight;
    await drawPlayerLine(ctx, posX, y, team[i], nameFont, eloFont);
  }
}

async function drawPlayerLine(
  ctx: CanvasRenderingContext2D,
  posX: number,
  posY: number,
  player: PlayerLine,
  nameFont: string,
  eloFont: string
): Promise<void> {
  const avatar = await loadAvatar(player.username);
  ctx.drawImage(avatar, Math.floor(posX), Math.floor(posY - 7), 40, 40);

  drawText(ctx, player.username, posX + 58.5, posY, nameFont, '#FFFFFF', 'left');
  const usernameWidth = measureTextWidth(ctx, player.username, nameFont);

  if (player.mvp && cachedMvp) {
    const mvpX = Math.floor(posX + 58.5 + usernameWidth + 10);
    const mvpY = Math.floor(posY - 17);
    ctx.drawImage(cachedMvp as CanvasImage, mvpX, mvpY);
  }

  const eloChange = player.newElo - player.oldElo;
  const eloChangeText = `${eloChange >= 0 ? '+' : ''}${eloChange}`;
  const oldEloText = String(player.oldElo);
  const newEloText = String(player.newElo);

  const changeCenterX = posX + 1130;
  const oldCenterX = posX + 1291;
  const newCenterX = posX + 1499;

  const changeWidth = measureTextWidth(ctx, eloChangeText, eloFont);
  const oldWidth = measureTextWidth(ctx, oldEloText, eloFont);
  const newWidth = measureTextWidth(ctx, newEloText, eloFont);

  drawText(ctx, eloChangeText, changeCenterX - changeWidth / 2, posY, eloFont, '#FFFFFF', 'left');
  drawText(ctx, oldEloText, oldCenterX - oldWidth / 2, posY, eloFont, '#757474', 'left');
  drawText(ctx, newEloText, newCenterX - newWidth / 2, posY, eloFont, '#FFFFFF', 'left');
}

export type { PlayerLine };