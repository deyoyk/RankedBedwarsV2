import User from '../models/User';
import { MapService } from '../managers/MapManager';

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
  const t2 = normalizeIdList(team2).filter(id => !t1.includes(id));
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
  maxplayers?: number;
  max_players?: number;
};

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
    const reservedMaps = useMatchmakingPath
      ? await svc.getReservedMapsForMatchmaking!(forceRefresh)
      : await svc.getReservedMaps(forceRefresh);
    const unlockedMaps = useMatchmakingPath
      ? await svc.getUnlockedMapsForMatchmaking!(forceRefresh)
      : await svc.getUnlockedMaps(forceRefresh);

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

    const candidates = preferUnblocked(reservedMaps.filter(m => mapSize(m) === queueData.maxPlayers));

    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      applyClaim(pick.name);
      return pick.name;
    }

    const unlockedCandidates = preferUnblocked(unlockedMaps.filter(m => mapSize(m) === queueData.maxPlayers));

    if (unlockedCandidates.length > 0) {
      const pick = unlockedCandidates[Math.floor(Math.random() * unlockedCandidates.length)];
      applyClaim(pick.name);
      return pick.name;
    }

    const anyUnlocked = preferUnblocked(unlockedMaps);
    if (anyUnlocked.length > 0) {
      const pick = anyUnlocked[Math.floor(Math.random() * anyUnlocked.length)];
      applyClaim(pick.name);
      return pick.name;
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
