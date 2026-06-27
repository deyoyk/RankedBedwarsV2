import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D, Image as CanvasImage } from 'canvas';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';

export type PlayerData = {
  discordid: string;
  ign: string;
  wins: number;
  losses: number;
  mvps: number;
  elo: number;
  gamesplayed?: number;
};

export type RecentGame = {
  gameid?: number | string;
  result?: 'win' | 'lose' | 'loss' | 'voided' | 'pending' | 'submitted' | string;
} | null;

export type Helpers = {
  calculateRating?: (playerData: PlayerData) => number;
  calculatePosition: (discordId: string) => number | string | Promise<number | string>;
};

const FONT_PATHS = {
  ADAMCGPRO: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'ADAM.CG PRO.otf'),
  PoppinsMedium: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-Medium.ttf'),
  PoppinsRegular: path.resolve(process.cwd(), 'src', 'asserts', 'fonts', 'Poppins-Regular.ttf'),
};

let fontsRegistered = false;

export function ensureFontsRegistered(tag: string): void {
  if (fontsRegistered) return;
  try {
    if (fs.existsSync(FONT_PATHS.ADAMCGPRO)) {
      registerFont(FONT_PATHS.ADAMCGPRO, { family: 'ADAMCGPRO' });
    } else {
      console.warn(`[${tag}] Missing font file:`, FONT_PATHS.ADAMCGPRO);
    }
    if (fs.existsSync(FONT_PATHS.PoppinsMedium)) {
      registerFont(FONT_PATHS.PoppinsMedium, { family: 'PoppinsMedium' });
    } else {
      console.warn(`[${tag}] Missing font file:`, FONT_PATHS.PoppinsMedium);
    }
    if (fs.existsSync(FONT_PATHS.PoppinsRegular)) {
      registerFont(FONT_PATHS.PoppinsRegular, { family: 'PoppinsRegular' });
    } else {
      console.warn(`[${tag}] Missing font file:`, FONT_PATHS.PoppinsRegular);
    }
    fontsRegistered = true;
  } catch (e) {
    console.warn(`[${tag}] Failed to register fonts:`, e);
  }
}

export async function fetchSkin(ign: string, pose: 'fullbody' | 'avatar' = 'fullbody'): Promise<CanvasImage | null> {
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

export function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, centerX: number, centerY: number, font: string, color = '#FFFFFF') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centerX, centerY);
}

export function drawLeftText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color = '#FFFFFF') {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

export function mvpRate(player: PlayerData): number {
  const mvps = player.mvps || 0;
  const gamesPlayed = player.gamesplayed || 0;
  if (gamesPlayed <= 0) return 0;
  return (mvps / gamesPlayed) * 100;
}

export function wlRatio(player: PlayerData): string {
  const wins = player.wins || 0;
  const losses = player.losses || 0;
  const ratio = wins / Math.max(1, losses);
  return ratio.toFixed(1);
}

export function getRecentColor(result?: string): string {
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

export function createShadowFromSkin(skin: CanvasImage): CanvasImage {
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

export function getThemeImagePath(themeName: string): string {
  return path.resolve(process.cwd(), 'src', 'asserts', 'themes', `${themeName}.png`);
}
