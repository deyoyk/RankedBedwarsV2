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

function mapSize(m: MapSize): number | undefined {
  return m.maxplayers ?? m.max_players;
}

export async function selectRandomMap(mapService: MapService, queueData: { maxPlayers: number }): Promise<string> {
  try {
    const reservedMaps = await mapService.getReservedMaps();
    const candidates = reservedMaps.filter(m => mapSize(m) === queueData.maxPlayers);

    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      return pick.name;
    }

    const unlockedMaps = await mapService.getUnlockedMaps();
    const unlockedCandidates = unlockedMaps.filter(m => mapSize(m) === queueData.maxPlayers);

    if (unlockedCandidates.length > 0) {
      const pick = unlockedCandidates[Math.floor(Math.random() * unlockedCandidates.length)];
      return pick.name;
    }

    if (unlockedMaps.length > 0) {
      const pick = unlockedMaps[Math.floor(Math.random() * unlockedMaps.length)];
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
