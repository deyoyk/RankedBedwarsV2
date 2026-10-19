import { loadSkinDataUrl } from '../images/assets';
import { renderPng } from '../images/renderer';
import { defaultTemplate, DefaultTile } from '../images/templates/default';

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

export type EnrichedPlayerData = PlayerData & {
  joined?: string;
  level?: number;
  xpToNext?: number;
  xpProgress?: number;
  games?: number;
  winRate?: number;
  winCaption?: string;
  tiles?: DefaultTile[];
  combat?: DefaultTile[];
  seasonLine1?: string;
  seasonLine2?: string;
};

const FALLBACK_TILES: DefaultTile[] = [
  { value: '0', label: 'Wins', accent: '#00e676', rank: '#-' },
  { value: '0', label: 'Losses', accent: '#ff5252', rank: '#-' },
  { value: '0.00', label: 'W/L ratio', accent: '#8b5cf6', rank: '#-' },
  { value: '0', label: 'Total Kills', accent: '#8b5cf6', rank: '#-' },
  { value: '0.00', label: 'K/D ratio', accent: '#00e5ff', rank: '#-' },
  { value: '0', label: 'MVPs', accent: '#ffd600', rank: '#-' },
  { value: '0', label: 'Streak', accent: '#ff9100', rank: '#-' },
  { value: '0m', label: 'Playtime', accent: '#ffd600', rank: '#-' },
];

const FALLBACK_COMBAT: DefaultTile[] = [
  { value: '0', label: 'Final Kills', accent: '#8b5cf6', rank: '#-' },
  { value: '0', label: 'Beds Broken', accent: '#8b5cf6', rank: '#-' },
  { value: '0', label: 'Final Deaths', accent: '#8b5cf6', rank: '#-' },
];

export async function generateThemeImage(
  playerData: PlayerData,
  recentGames: RecentGame[],
  helpers: Helpers
): Promise<Buffer> {
  void recentGames;
  const enriched = playerData as EnrichedPlayerData;
  const games = enriched.games ?? (playerData.wins || 0) + (playerData.losses || 0);
  const winRate = enriched.winRate ?? (games > 0 ? (playerData.wins || 0) / games : 0);
  const positionValue = await Promise.resolve(helpers.calculatePosition(String((playerData as any).discordid)));
  const footerBrand = (process.env.SERVER_IP || '').trim();

  const tpl = defaultTemplate({
    ign: playerData.ign || 'Player',
    joined: enriched.joined || '',
    level: enriched.level || 1,
    xpToNext: enriched.xpToNext ?? 0,
    xpProgress: enriched.xpProgress ?? 0,
    skin: await loadSkinDataUrl(playerData.ign || ''),
    elo: playerData.elo || 0,
    globalRank: positionValue,
    wins: String(playerData.wins || 0),
    losses: String(playerData.losses || 0),
    winRate,
    winCaption: enriched.winCaption || `${(winRate * 100).toFixed(1)}% win rate · ${games} games`,
    tiles: enriched.tiles && enriched.tiles.length === 8 ? enriched.tiles : FALLBACK_TILES,
    combat: enriched.combat && enriched.combat.length === 3 ? enriched.combat : FALLBACK_COMBAT,
    seasonLine1: enriched.seasonLine1 || '',
    seasonLine2: enriched.seasonLine2 || '',
    footerBrand,
  });
  return renderPng(tpl.root, tpl.width, tpl.height);
}
