import User from '../models/User';
import { MapService } from '../managers/MapManager';
import config from '../config/config';
import { pickLeastPlayedMap, resolveMapFrequencyOptions, scoreMapsByFrequency } from '../utils/mapFrequency';
import { getPlayerIgns } from '../utils/playerDirectory';

export function normalizeIdList(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = (raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeTeams(team1: string[], team2: string[]): { team1: string[]; team2: string[] } {
  const t1 = normalizeIdList(team1);
  const seen = new Set(t1);
  const t2 = normalizeIdList(team2).filter(id => !seen.has(id));
  return { team1: t1, team2: t2 };
}

export function normalizeIgnKey(ign: string): string {
  return (ign ?? '').trim().toLowerCase();
}

export interface BedwarsPresenceChecker {
  checkPlayers?: (igns: string[]) => Promise<Map<string, { online: boolean | null; inGame: boolean }>>;
  checkBedwarsPlayers?: (igns: string[]) => Promise<Map<string, boolean>>;
}

export async function findInGamePlayerIds(
  checker: BedwarsPresenceChecker | null | undefined,
  playerIds: string[],
  ignById: Map<string, string>
): Promise<Set<string>> {
  const inGame = new Set<string>();
  if (!checker) return inGame;
  const ids = normalizeIdList(playerIds);
  if (ids.length === 0) return inGame;
  const igns = [...new Set(ids.map(id => ignById.get(id)).filter((ign): ign is string => Boolean(ign)))];
  if (igns.length === 0) return inGame;
  const ignToId = new Map<string, string>();
  for (const [id, ign] of ignById) ignToId.set(normalizeIgnKey(ign), id);

  const missing: string[] = [];
  if (typeof checker.checkPlayers === 'function') {
    try {
      const statuses = await checker.checkPlayers(igns);
      for (const ign of igns) {
        const status = statuses.get(normalizeIgnKey(ign));
        if (status) {
          if (status.inGame) {
            const id = ignToId.get(normalizeIgnKey(ign));
            if (id) inGame.add(id);
          }
        } else {
          missing.push(ign);
        }
      }
    } catch (error) {
      console.warn('[MatchmakingUtils] Bulk player status check failed:', error);
      missing.push(...igns);
    }
  } else {
    missing.push(...igns);
  }

  if (missing.length > 0 && typeof checker.checkBedwarsPlayers === 'function') {
    try {
      const statuses = await checker.checkBedwarsPlayers(missing);
      for (const [ign, inGameFlag] of statuses) {
        if (!inGameFlag) continue;
        const id = ignToId.get(normalizeIgnKey(ign));
        if (id) inGame.add(id);
      }
    } catch (error) {
      console.warn('[MatchmakingUtils] BedWars status check failed:', error);
    }
  }
  return inGame;
}

export async function isIgnInGame(
  checker: BedwarsPresenceChecker | null | undefined,
  ign: string
): Promise<boolean> {
  if (!checker) return false;
  try {
    if (typeof checker.checkPlayers === 'function') {
      const statuses = await checker.checkPlayers([ign]);
      const status = statuses.get(normalizeIgnKey(ign));
      if (status) return status.inGame;
    }
    if (typeof checker.checkBedwarsPlayers === 'function') {
      const statuses = await checker.checkBedwarsPlayers([ign]);
      return statuses.get(normalizeIgnKey(ign)) === true;
    }
  } catch (error) {
    console.warn('[MatchmakingUtils] Single player status check failed:', error);
  }
  return false;
}

export function calculateTeamAverageEloFromDocs(docs: Array<{ elo?: number | null }>): number {
  if (docs.length === 0) return 0;
  const totalElo = docs.reduce((sum, user) => sum + (user.elo || 0), 0);
  return Math.round(totalElo / docs.length);
}

export async function calculateTeamAverageElo(
  playerIds: string[],
  preloadedElos?: Map<string, number>
): Promise<number> {
  try {
    const ids = normalizeIdList(playerIds);
    if (ids.length === 0) return 0;

    if (preloadedElos) {
      const elos: number[] = [];
      for (const id of ids) {
        const elo = preloadedElos.get(id);
        if (typeof elo === 'number') elos.push(elo);
      }
      if (elos.length === 0) return 0;
      return Math.round(elos.reduce((sum, elo) => sum + elo, 0) / elos.length);
    }

    const users = await User.find({
      discordId: { $in: ids }
    }).select('elo');

    if (users.length === 0) return 0;
    return calculateTeamAverageEloFromDocs(users);
  } catch (error) {
    console.error('[MatchmakingUtils] Error calculating team average ELO:', error);
    return 0;
  }
}

type MapSize = {
  name: string;
  physical_name?: string;
  maxplayers?: number;
  max_players?: number;
};

function resolveWarpMapName(m: MapSize): string {
  return m.physical_name ?? m.name;
}

export const TENTATIVE_MAP_CLAIM_TTL_MS = 30 * 1000;

const recentMapPicks: Map<string, number> = new Map();

function pruneRecentMapPicks(ttlMs: number = TENTATIVE_MAP_CLAIM_TTL_MS): void {
  const now = Date.now();
  for (const [name, ts] of recentMapPicks) {
    if (now - ts > ttlMs) recentMapPicks.delete(name);
  }
}

export function getRecentMapPicks(ttlMs: number = TENTATIVE_MAP_CLAIM_TTL_MS): Set<string> {
  pruneRecentMapPicks(ttlMs);
  return new Set(recentMapPicks.keys());
}

export function claimMapPick(name: string): void {
  if (!name) return;
  pruneRecentMapPicks();
  recentMapPicks.set(name, Date.now());
}

export function clearRecentMapPicks(): void {
  recentMapPicks.clear();
}

function toExcludedSet(excluded?: Set<string> | string[]): Set<string> {
  if (!excluded) return new Set();
  return excluded instanceof Set ? new Set(excluded) : new Set(excluded);
}

export interface SelectRandomMapOptions {
  forceRefresh?: boolean;
  excludedNames?: Set<string> | string[];
  playerIds?: string[];
  claim?: boolean;
}

function resolveSelectArgs(
  third?: boolean | SelectRandomMapOptions,
  fourth?: Set<string> | string[]
): { forceRefresh: boolean; excludedNames: Set<string>; claim: boolean } {
  if (typeof third === 'boolean') {
    return { forceRefresh: third, excludedNames: toExcludedSet(fourth), claim: true };
  }
  return {
    forceRefresh: third?.forceRefresh ?? false,
    excludedNames: toExcludedSet(third?.excludedNames ?? fourth),
    claim: third?.claim !== false
  };
}

function mapSize(m: MapSize): number | undefined {
  return m.maxplayers ?? m.max_players;
}

type MapServiceView = {
  getReservedMapsForMatchmaking?: (force?: boolean) => Promise<MapSize[]>;
  getUnlockedMapsForMatchmaking?: (force?: boolean) => Promise<MapSize[]>;
  getReservedMaps: (force?: boolean) => Promise<MapSize[]>;
  getUnlockedMaps: (force?: boolean) => Promise<MapSize[]>;
  claimMap?: (name: string) => void;
  getRecentlyClaimedNames?: (ttlMs?: number) => Set<string>;
  getRecentPickHistory?: (limit?: number) => string[];
  requestMaps?: () => void;
};

interface MapSelectionPool {
  reservedMaps: MapSize[];
  unlockedMaps: MapSize[];
  blocked: Set<string>;
  frequencyOptions: ReturnType<typeof resolveMapFrequencyOptions>;
  playerRecent: string[][];
  globalHistory: string[];
}

export const MAP_VOTE_OPTION_COUNT = 3;

async function loadMapSelectionPool(
  mapService: MapService,
  forceRefresh: boolean,
  excludedNames: Set<string>,
  playerIds?: string[]
): Promise<MapSelectionPool> {
  const svc = mapService as unknown as MapServiceView;
  const useMatchmakingPath =
    typeof svc.getReservedMapsForMatchmaking === 'function' &&
    typeof svc.getUnlockedMapsForMatchmaking === 'function';
  const reservedPromise = useMatchmakingPath
    ? svc.getReservedMapsForMatchmaking!(forceRefresh)
    : (typeof svc.getReservedMaps === 'function' ? svc.getReservedMaps(forceRefresh) : Promise.resolve([] as MapSize[]));
  const unlockedPromise = useMatchmakingPath
    ? svc.getUnlockedMapsForMatchmaking!(forceRefresh)
    : (typeof svc.getUnlockedMaps === 'function' ? svc.getUnlockedMaps(forceRefresh) : Promise.resolve([] as MapSize[]));
  const [reservedMaps, unlockedMaps] = await Promise.all([reservedPromise, unlockedPromise]);

  pruneRecentMapPicks();
  const blocked = new Set<string>([...recentMapPicks.keys(), ...excludedNames]);
  try {
    const claimed = svc.getRecentlyClaimedNames?.();
    if (claimed) for (const name of claimed) blocked.add(name);
  } catch {
  }

  const frequencyOptions = resolveMapFrequencyOptions(config.mapFrequency);
  const frequencyIds = frequencyOptions.enabled ? normalizeIdList(playerIds ?? []) : [];
  let playerRecent: string[][] = [];
  let globalHistory: string[] = [];
  if (frequencyIds.length > 0) {
    try {
      const docs = await User.find({ discordId: { $in: frequencyIds } }).select('discordId recentGames').lean() as Array<{ discordId: string; recentGames?: Array<{ map?: unknown; date?: unknown }> }>;
      const byId = new Map((docs ?? []).map(d => [d.discordId, d]));
      playerRecent = frequencyIds.map(id => {
        const games = [...(byId.get(id)?.recentGames ?? [])];
        games.sort((a, b) => new Date(b.date as never).getTime() - new Date(a.date as never).getTime());
        return games
          .slice(0, frequencyOptions.lookbackGames)
          .map(g => g.map)
          .filter((m): m is string => typeof m === 'string' && m.length > 0);
      });
    } catch {
      playerRecent = [];
    }
    try {
      if (typeof svc.getRecentPickHistory === 'function') {
        globalHistory = svc.getRecentPickHistory(frequencyOptions.historySize);
      } else if (typeof svc.getRecentlyClaimedNames === 'function') {
        globalHistory = [...(svc.getRecentlyClaimedNames() ?? [])];
      }
    } catch {
      globalHistory = [];
    }
  }

  return { reservedMaps, unlockedMaps, blocked, frequencyOptions, playerRecent, globalHistory };
}

function preferUnblocked(list: MapSize[], blocked: Set<string>): MapSize[] {
  if (blocked.size === 0) return list;
  const open = list.filter(m => !blocked.has(m.name));
  return open.length > 0 ? open : list;
}

function pickFromTier(tier: MapSize[], pool: MapSelectionPool): MapSize | null {
  if (tier.length === 0) return null;
  if (pool.playerRecent.length === 0 && pool.globalHistory.length === 0) {
    return tier[Math.floor(Math.random() * tier.length)];
  }
  const scored = scoreMapsByFrequency(tier.map(m => m.name), pool.playerRecent, pool.globalHistory, pool.frequencyOptions);
  const chosen = pickLeastPlayedMap(scored);
  return tier.find(m => m.name === chosen) ?? tier[Math.floor(Math.random() * tier.length)];
}

function rankTier(tier: MapSize[], pool: MapSelectionPool): MapSize[] {
  if (tier.length === 0) return [];
  if (pool.playerRecent.length === 0 && pool.globalHistory.length === 0) return [...tier];
  const scored = scoreMapsByFrequency(tier.map(m => m.name), pool.playerRecent, pool.globalHistory, pool.frequencyOptions);
  const heat = new Map(scored.map(entry => [entry.name, entry.heat]));
  return [...tier].sort((a, b) => (heat.get(a.name) ?? 0) - (heat.get(b.name) ?? 0));
}

export async function selectRandomMap(
  mapService: MapService,
  queueData: { maxPlayers: number },
  optionsOrForceRefresh?: boolean | SelectRandomMapOptions,
  maybeExcluded?: Set<string> | string[]
): Promise<string> {
  try {
    const { forceRefresh, excludedNames, claim } = resolveSelectArgs(optionsOrForceRefresh, maybeExcluded);
    const playerIds = (typeof optionsOrForceRefresh === 'object' && optionsOrForceRefresh !== null && !Array.isArray(optionsOrForceRefresh))
      ? optionsOrForceRefresh.playerIds
      : undefined;
    const pool = await loadMapSelectionPool(mapService, forceRefresh, excludedNames, playerIds);
    const svc = mapService as unknown as MapServiceView;

    const pickAndClaim = (tier: MapSize[]): string | null => {
      const candidates = preferUnblocked(tier, pool.blocked);
      const pick = pickFromTier(candidates, pool);
      if (!pick) return null;
      const warpName = resolveWarpMapName(pick);
      if (claim) {
        claimMapPick(warpName);
        try { svc.claimMap?.(warpName); } catch { }
      }
      return warpName;
    };

    const reservedPick = pickAndClaim(pool.reservedMaps.filter(m => mapSize(m) === queueData.maxPlayers));
    if (reservedPick) return reservedPick;

    const unlockedPick = pickAndClaim(pool.unlockedMaps.filter(m => mapSize(m) === queueData.maxPlayers));
    if (unlockedPick) return unlockedPick;

    const anyPick = pickAndClaim(pool.unlockedMaps);
    if (anyPick) return anyPick;

    try { svc.requestMaps?.(); } catch { }
    throw new Error('No maps available: the plugin has not sent map data yet');
  } catch (error) {
    console.error('[MatchmakingUtils] Error selecting map:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function selectMapVoteCandidates(
  mapService: MapService,
  queueData: { maxPlayers: number },
  playerIds?: string[],
  count: number = MAP_VOTE_OPTION_COUNT
): Promise<string[]> {
  try {
    const target = Number.isFinite(count) && count > 0 ? Math.floor(count) : MAP_VOTE_OPTION_COUNT;
    const pool = await loadMapSelectionPool(mapService, false, new Set(), playerIds);
    const tiers = [
      preferUnblocked(pool.reservedMaps.filter(m => mapSize(m) === queueData.maxPlayers), pool.blocked),
      preferUnblocked(pool.unlockedMaps.filter(m => mapSize(m) === queueData.maxPlayers), pool.blocked),
      preferUnblocked(pool.unlockedMaps, pool.blocked),
    ];
    const selected: MapSize[] = [];
    const seen = new Set<string>();
    for (const tier of tiers) {
      for (const map of rankTier(tier, pool)) {
        const name = resolveWarpMapName(map);
        if (seen.has(name)) continue;
        seen.add(name);
        selected.push(map);
        if (selected.length >= target) break;
      }
      if (selected.length >= target) break;
    }

    if (selected.length === 0) {
      try { (mapService as unknown as MapServiceView).requestMaps?.(); } catch { }
      throw new Error('No maps available: the plugin has not sent map data yet');
    }
    return selected.map(resolveWarpMapName);
  } catch (error) {
    console.error('[MatchmakingUtils] Error selecting map choices:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function getPlayerIGNs(playerIds: string[]): Promise<Map<string, string>> {
  return getPlayerIgns(playerIds);
}
