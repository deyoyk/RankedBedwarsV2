import { loadSkinDataUrl } from '../assets';
import config from '../../config/config';
import { renderPng } from '../renderer';
import { defaultTemplate, MatchResult } from './default';

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
  result?: 'win' | 'lose' | 'loss' | 'voided' | 'pending' | 'submitted' | 'active' | string;
} | null;

export type Helpers = {
  calculateRating?: (playerData: PlayerData) => number;
  calculatePosition: (discordId: string) => number | string | Promise<number | string>;
};

export type StatPositions = {
  elo: string;
  wins: string;
  losses: string;
  wlr: string;
  mvps: string;
  beds: string;
  streak: string;
};

export type EnrichedPlayerData = PlayerData & {
  rankName?: string;
  rankColor?: string;
  wlr?: string;
  beds?: number;
  streak?: number;
  positions?: Partial<StatPositions>;
};

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

function toMatch(result?: string | null): MatchResult {
  if (result === 'win') return 'win';
  if (result === 'lose' || result === 'loss') return 'loss';
  if (result === 'voided') return 'voided';
  if (result === 'pending' || result === 'active' || result === 'submitted') return 'active';
  return 'unknown';
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export async function generateThemeImage(
  playerData: PlayerData,
  recentGames: RecentGame[],
  _helpers: Helpers
): Promise<Buffer> {
  const enriched = playerData as EnrichedPlayerData;
  const games = enriched.gamesplayed ?? (playerData.wins || 0) + (playerData.losses || 0);
  const wins = playerData.wins || 0;
  const losses = playerData.losses || 0;
  const wlr = enriched.wlr ?? (losses > 0 ? (wins / losses).toFixed(2) : wins > 0 ? String(wins) : 'N/A');
  const matches = recentGames.slice(0, 10).map(game => toMatch(game?.result));
  const rankName = enriched.rankName || 'Unranked';
  const rankColor = enriched.rankColor || '#56486A';
  const streak = enriched.streak ?? 0;
  const positions: StatPositions = {
    elo: enriched.positions?.elo ?? '#-',
    wins: enriched.positions?.wins ?? '#-',
    losses: enriched.positions?.losses ?? '#-',
    wlr: enriched.positions?.wlr ?? '#-',
    mvps: enriched.positions?.mvps ?? '#-',
    beds: enriched.positions?.beds ?? '#-',
    streak: enriched.positions?.streak ?? '#-',
  };
  const cacheKey = `${playerData.discordid}|${playerData.ign}|${games}|${wins}|${losses}|${playerData.elo}|${playerData.mvps}|${rankName}|${rankColor}|${wlr}|${enriched.beds ?? 0}|${streak}|${matches.join(',')}|${config.inviteLink}|${Object.values(positions).join(',')}`;

  const cached = statsImageCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= STATS_IMAGE_TTL_MS) {
    return cached.buffer;
  }
  if (cached) statsImageCache.delete(cacheKey);

  const ongoing = statsImageInflight.get(cacheKey);
  if (ongoing) return ongoing;

  const task = (async (): Promise<Buffer> => {
    const skin = await withTimeout(
      loadSkinDataUrl(playerData.ign || ''),
      SKIN_TIMEOUT_MS,
      null,
    );

    const tpl = defaultTemplate({
      ign: playerData.ign || 'Player',
      skin,
      elo: playerData.elo || 0,
      rankName,
      rankColor,
      wins: String(wins),
      losses: String(losses),
      wlr,
      mvps: String(playerData.mvps || 0),
      beds: String(enriched.beds ?? 0),
      streak: signed(streak),
      matches,
      inviteLink: config.inviteLink,
      positions,
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
