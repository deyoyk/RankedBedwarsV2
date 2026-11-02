import User from '../models/User';
import { MapService } from '../managers/MapManager';
import config from '../config/config';
import { scoreMapsByFrequency, pickLeastPlayedMap, resolveMapFrequencyOptions } from '../utils/mapFrequency';

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
}

function resolveSelectArgs(
  third?: boolean | SelectRandomMapOptions,
  fourth?: Set<string> | string[]
): { forceRefresh: boolean; excludedNames: Set<string> } {
  if (typeof third === 'boolean') {
    return { forceRefresh: third, excludedNames: toExcludedSet(fourth) };
  }
  return {
    forceRefresh: third?.forceRefresh ?? false,
    excludedNames: toExcludedSet(third?.excludedNames ?? fourth)
  };
}

function mapSize(m: MapSize): number | undefined {
  return m.maxplayers ?? m.max_players;
}

export async function selectRandomMap(
  mapService: MapService,
  queueData: { maxPlayers: number },
  optionsOrForceRefresh?: boolean | SelectRandomMapOptions,
  maybeExcluded?: Set<string> | string[]
): Promise<string> {
  try {
    const { forceRefresh, excludedNames } = resolveSelectArgs(optionsOrForceRefresh, maybeExcluded);
    const svc = mapService as unknown as {
      getReservedMapsForMatchmaking?: (force?: boolean) => Promise<MapSize[]>;
      getUnlockedMapsForMatchmaking?: (force?: boolean) => Promise<MapSize[]>;
      getReservedMaps: (force?: boolean) => Promise<MapSize[]>;
      getUnlockedMaps: (force?: boolean) => Promise<MapSize[]>;
      claimMap?: (name: string) => void;
      getRecentlyClaimedNames?: (ttlMs?: number) => Set<string>;
    };
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
      if (claimed) for (const n of claimed) blocked.add(n);
    } catch {
    }
    const preferUnblocked = (list: MapSize[]) => {
      if (blocked.size === 0) return list;
      const open = list.filter(m => !blocked.has(m.name));
      return open.length > 0 ? open : list;
    };

    const applyClaim = (name: string) => {
      claimMapPick(name);
      try { svc.claimMap?.(name); } catch { /* ignore */ }
    };

    const freqOpts = resolveMapFrequencyOptions(config.mapFrequency);
    const optPlayerIds = (typeof optionsOrForceRefresh === 'object' && optionsOrForceRefresh !== null && !Array.isArray(optionsOrForceRefresh))
      ? (optionsOrForceRefresh as SelectRandomMapOptions).playerIds
      : undefined;
    const frequencyIds = freqOpts.enabled ? normalizeIdList(optPlayerIds ?? []) : [];
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
            .slice(0, freqOpts.lookbackGames)
            .map(g => g.map)
            .filter((m): m is string => typeof m === 'string' && m.length > 0);
        });
      } catch {
        playerRecent = [];
      }
      try {
        const svcAny = svc as unknown as { getRecentPickHistory?: (limit?: number) => string[]; getRecentlyClaimedNames?: (ttlMs?: number) => Set<string> };
        if (typeof svcAny.getRecentPickHistory === 'function') {
          globalHistory = svcAny.getRecentPickHistory(freqOpts.historySize);
        } else if (typeof svcAny.getRecentlyClaimedNames === 'function') {
          globalHistory = [...(svcAny.getRecentlyClaimedNames() ?? [])];
        }
      } catch {
        globalHistory = [];
      }
    }

    const pickFromTier = (tier: MapSize[]): MapSize | null => {
      if (tier.length === 0) return null;
      if (playerRecent.length === 0 && globalHistory.length === 0) {
        return tier[Math.floor(Math.random() * tier.length)];
      }
      const scored = scoreMapsByFrequency(tier.map(m => m.name), playerRecent, globalHistory, freqOpts);
      const chosen = pickLeastPlayedMap(scored);
      return tier.find(m => m.name === chosen) ?? tier[Math.floor(Math.random() * tier.length)];
    };

    const candidates = preferUnblocked(reservedMaps.filter(m => mapSize(m) === queueData.maxPlayers));

    const reservedPick = pickFromTier(candidates);
    if (reservedPick) {
      const warpName = resolveWarpMapName(reservedPick);
      applyClaim(warpName);
      return warpName;
    }

    const unlockedCandidates = preferUnblocked(unlockedMaps.filter(m => mapSize(m) === queueData.maxPlayers));

    const unlockedPick = pickFromTier(unlockedCandidates);
    if (unlockedPick) {
      const warpName = resolveWarpMapName(unlockedPick);
      applyClaim(warpName);
      return warpName;
    }

    const anyUnlocked = preferUnblocked(unlockedMaps);
    const anyPick = pickFromTier(anyUnlocked);
    if (anyPick) {
      const warpName = resolveWarpMapName(anyPick);
      applyClaim(warpName);
      return warpName;
    }

    return 'Aquarius';
  } catch (error) {
    console.error('[MatchmakingUtils] Error selecting map:', error);
    return 'Aquarius';
  }
}

export async function getPlayerIGNs(playerIds: string[]): Promise<Map<string, string>> {
  try {
    const ids = normalizeIdList(playerIds);
    if (ids.length === 0) return new Map();
    const users = await User.find({
      discordId: { $in: ids }
    }).select('discordId ign');

    return new Map(users.map(u => [u.discordId, u.ign]));
  } catch (error) {
    console.error('[MatchmakingUtils] Error getting player IGNs:', error);
    return new Map();
  }
}
