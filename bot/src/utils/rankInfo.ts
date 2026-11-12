import type { Guild } from 'discord.js';
import EloRank from '../models/EloRank';
import type { RankInfo } from '../themes/base';

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
    iconUrl: role?.iconURL({ extension: 'png', size: 64 }) ?? null,
  };
}

/** The player's rank and the next one, named and coloured after the guild's rank roles. */
export async function getRankInfo(elo: number, guild?: Guild | null): Promise<RankInfo> {
  const ranks = (await EloRank.find().select('roleId startElo endElo').sort({ startElo: 1 }).lean()) as unknown as RankRow[];
  if (ranks.length === 0) return { ...UNRANKED };

  let index = ranks.findIndex(r => elo >= r.startElo && elo <= r.endElo);
  if (index === -1) index = elo >= ranks[ranks.length - 1].startElo ? ranks.length - 1 : 0;
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
