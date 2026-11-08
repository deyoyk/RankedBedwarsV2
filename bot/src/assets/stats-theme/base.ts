import { loadBustDataUrl } from '../assets';
import { renderPng } from '../renderer';
import { defaultTemplate, DefaultTile } from './default';

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
  game_id?: number | string;
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

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const STATS_IMAGE_TTL_MS = intEnv('IMAGE_STATS_CACHE_MS', 5000, 0, 600000);
const STATS_IMAGE_CACHE_MAX = intEnv('IMAGE_STATS_CACHE_MAX', 100, 1, 2000);
const SKIN_TIMEOUT_MS = intEnv('IMAGE_SKIN_TIMEOUT_MS', 5000, 500, 30000);

type StatsImageCacheEntry = {
  at: number;
  buffer: Buffer;
};

const statsImageCache = new Map<string, StatsImageCacheEntry>();
const statsImageInflight = new Map<string, Promise<Buffer>>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function storeStatsImage(key: string, buffer: Buffer): void {
  if (STATS_IMAGE_TTL_MS <= 0) return;
  if (!statsImageCache.has(key) && statsImageCache.size >= STATS_IMAGE_CACHE_MAX) {
    const oldest = statsImageCache.keys().next();
    if (!oldest.done) statsImageCache.delete(oldest.value);
  }
  statsImageCache.set(key, { at: Date.now(), buffer });
}

export async function generateThemeImage(
  playerData: PlayerData,
  recentGames: RecentGame[],
  helpers: Helpers
): Promise<Buffer> {
  void recentGames;
  const enriched = playerData as EnrichedPlayerData;
  const games = enriched.games ?? (playerData.wins || 0) + (playerData.losses || 0);
  const winRate = enriched.winRate ?? (games > 0 ? (playerData.wins || 0) / games : 0);
  const positionValue = await Promise.resolve(helpers.calculatePosition(String(playerData.discordid)));
  const footerBrand = (process.env.SERVER_IP || '').trim();
  const cacheKey = `${playerData.discordid}|${JSON.stringify(playerData)}|${String(positionValue)}|${footerBrand}`;

  const cached = statsImageCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= STATS_IMAGE_TTL_MS) {
    return cached.buffer;
  }
  if (cached) statsImageCache.delete(cacheKey);

  const ongoing = statsImageInflight.get(cacheKey);
  if (ongoing) return ongoing;

  const task = (async (): Promise<Buffer> => {
    const skin = await withTimeout(
      loadBustDataUrl(playerData.ign || ''),
      SKIN_TIMEOUT_MS,
      null,
    );

    const tpl = defaultTemplate({
      ign: playerData.ign || 'Player',
      joined: enriched.joined || '',
      level: enriched.level || 1,
      xpToNext: enriched.xpToNext ?? 0,
      xpProgress: enriched.xpProgress ?? 0,
      skin,
      elo: playerData.elo || 0,
      globalRank: positionValue,
      wins: String(playerData.wins || 0),
      losses: String(playerData.losses || 0),
      winRate,
      winCaption: enriched.winCaption || `${(winRate * 100).toFixed(1)}% win rate · ${games} games`,
      tiles: enriched.tiles && enriched.tiles.length === 8 ? enriched.tiles : FALLBACK_TILES,
      combat: enriched.combat && enriched.combat.length >= 3 ? enriched.combat : FALLBACK_COMBAT,
      seasonLine1: enriched.seasonLine1 || '',
      seasonLine2: enriched.seasonLine2 || '',
      footerBrand,
    });

    const buffer = await renderPng(tpl.root, tpl.width, tpl.height);
    storeStatsImage(cacheKey, buffer);
    return buffer;
  })();

  statsImageInflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    statsImageInflight.delete(cacheKey);
  }
}
