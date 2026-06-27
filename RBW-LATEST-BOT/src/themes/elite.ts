import { createCanvas, loadImage, CanvasRenderingContext2D, Image as CanvasImage } from 'canvas';
import { PlayerData, RecentGame, Helpers, ensureFontsRegistered, fetchSkin, drawCenteredText, drawLeftText, mvpRate, wlRatio, getRecentColor, createShadowFromSkin, getThemeImagePath } from './base';

const THEME_IMAGE_PATH = getThemeImagePath('elite');

async function generateEliteThemeImage(
  playerData: PlayerData,
  recentGames: RecentGame[],
  helpers: Helpers
): Promise<Buffer> {
  ensureFontsRegistered('themes/elite');

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
  generate: generateEliteThemeImage,
};
