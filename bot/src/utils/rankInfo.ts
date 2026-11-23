import type { Guild } from 'discord.js';
import EloRank from '../models/EloRank';

export type RankInfo = {
  name: string;
  color: string;
  startElo: number;
  endElo: number;
  nextRankName?: string;
  nextRankColor?: string;
  nextRankStartElo?: number;
  isMaxRank?: boolean;
  roleId?: string;
  iconUrl?: string | null;
  unicodeEmoji?: string | null;
  customEmoji?: string | null;
  nextRankIconUrl?: string | null;
};

const UNRANKED: RankInfo = { name: 'Unranked', color: '#AAAAAA', startElo: 0, endElo: 0, isMaxRank: true };

interface RankRow {
  roleId: string;
  startElo: number;
  endElo: number;
}

function roleLook(guild: Guild | null | undefined, roleId: string) {
  const role = guild?.roles.cache.get(roleId);
  return {
    name: role?.name ?? 'Rank',
    color: role && role.color !== 0 ? role.hexColor : '#FFFFFF',
    color2: role?.colors?.secondaryColor != null ? `#${role.colors.secondaryColor.toString(16).padStart(6, '0')}` : undefined,
    iconUrl: role?.iconURL({ extension: 'png', size: 64 }) ?? null,
  };
}

function rankIndex(elo: number, sorted: Array<{ startElo: number; endElo: number }>): number {
  const index = sorted.findIndex(r => elo >= r.startElo && elo <= r.endElo);
  if (index !== -1) return index;
  return elo >= sorted[sorted.length - 1].startElo ? sorted.length - 1 : 0;
}

/** The rank a player is scored and shown with: the one holding their ELO, else the nearest end of the ladder. */
export function rankForElo<T extends { startElo: number; endElo: number }>(elo: number, ranks: T[]): T | undefined {
  if (ranks.length === 0) return undefined;
  const sorted = ranks.slice().sort((a, b) => a.startElo - b.startElo);
  return sorted[rankIndex(elo, sorted)];
}

export interface RankProgress {
  name: string;
  color: string;
  color2?: string;
  start: number;
  end: number;
  win_elo: number;
  next: { name: string; color: string; start: number } | null;
}

/** Where an ELO sits on the rank ladder, for the Minecraft server's progress bar after a game. */
export function rankProgressFor(
  elo: number,
  ranks: Array<RankRow & { winElo: number }>,
  guild?: Guild | null
): RankProgress | null {
  if (ranks.length === 0) return null;
  const sorted = ranks.slice().sort((a, b) => a.startElo - b.startElo);
  const index = rankIndex(elo, sorted);
  const current = sorted[index];
  const next = sorted[index + 1];
  const look = roleLook(guild, current.roleId);
  const nextLook = next ? roleLook(guild, next.roleId) : null;
  return {
    name: look.name,
    color: look.color,
    ...(look.color2 ? { color2: look.color2 } : {}),
    start: current.startElo,
    end: current.endElo,
    win_elo: current.winElo,
    next: next && nextLook ? { name: nextLook.name, color: nextLook.color, start: next.startElo } : null,
  };
}

/** The player's rank and the next one, named and coloured after the guild's rank roles. */
export async function getRankInfo(elo: number, guild?: Guild | null): Promise<RankInfo> {
  const ranks = (await EloRank.find().select('roleId startElo endElo').sort({ startElo: 1 }).lean()) as unknown as RankRow[];
  if (ranks.length === 0) return { ...UNRANKED };

  const index = rankIndex(elo, ranks);
  const current = ranks[index];
  const next = ranks[index + 1];
  const look = roleLook(guild, current.roleId);
  const nextLook = next ? roleLook(guild, next.roleId) : null;

  return {
    name: look.name,
    color: look.color,
    startElo: current.startElo,
    endElo: current.endElo,
    roleId: current.roleId,
    iconUrl: look.iconUrl,
    isMaxRank: !next,
    nextRankName: nextLook?.name,
    nextRankColor: nextLook?.color,
    nextRankStartElo: next?.startElo,
    nextRankIconUrl: nextLook?.iconUrl ?? null,
  };
}
