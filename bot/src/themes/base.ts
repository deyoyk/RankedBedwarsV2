import { loadSkinDataUrl, staticImageDataUrl } from '../images/assets';
import { renderPng } from '../images/renderer';
import { themeTemplate, ThemeRecentGame } from '../images/templates/theme';

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

export async function generateThemeImage(
  themeName: string,
  playerData: PlayerData,
  recentGames: RecentGame[],
  helpers: Helpers
): Promise<Buffer> {
  const serverName = process.env.SERVER_NAME || 'ZeroCode';
  const inviteLink = process.env.INVITE_LINK || 'discord.gg/zerocode';

  const positionValue = await Promise.resolve(helpers.calculatePosition(String(playerData.discordid)));
  const rating = helpers.calculateRating ? helpers.calculateRating(playerData) : playerData.elo;

  const padded: RecentGame[] = [...recentGames];
  while (padded.length < 10) padded.push(null);
  const recent: ThemeRecentGame[] = padded.slice(0, 10).map((g) => ({
    label: g ? `Game #${g.gameid ?? 'N/A'}` : 'No Game',
    color: getRecentColor(g?.result),
  }));

  const tpl = themeTemplate({
    bg: staticImageDataUrl('themes', `${themeName}.png`),
    serverName,
    inviteLink,
    ign: playerData.ign || '',
    skin: await loadSkinDataUrl(playerData.ign || ''),
    wins: String(playerData.wins),
    rank: `#${positionValue}`,
    mvps: String(playerData.mvps),
    rating: String(rating),
    wlr: `${wlRatio(playerData)} W/L`,
    mvpRate: `${Math.round(mvpRate(playerData))}% RATE`,
    recent,
  });
  return renderPng(tpl.root, tpl.width, tpl.height);
}
