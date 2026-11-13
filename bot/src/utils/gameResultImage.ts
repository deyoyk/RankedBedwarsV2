import type { Guild } from 'discord.js';
import EloRank from '../models/EloRank';
import User from '../models/User';
import { renderScoredGame, ScoredPlayer } from './scoredGameImage';

interface ResultGame {
  gameId: number;
  state?: string;
  map?: string;
  winners?: string[];
  losers?: string[];
  mvps?: string[];
  bedbreaks?: string[];
  startTime?: Date | string;
  endTime?: Date | string;
}

/** "12:34" for a finished game, or null when start/end are missing. */
export function formatGameDuration(game: { startTime?: Date | string; endTime?: Date | string }): string | null {
  if (!game.startTime || !game.endTime) return null;
  const total = Math.max(0, Math.floor((new Date(game.endTime).getTime() - new Date(game.startTime).getTime()) / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

type RecentEntry = { eloGain?: number; elo_before?: number; elo_after?: number; kills?: number; deaths?: number; diamonds?: number };

/**
 * The scored-game card from the score post, rebuilt from the stored game for /gameinfo.
 * Null for games that were never scored (in progress or voided before scoring).
 */
export async function buildGameResultImage(game: ResultGame, guild?: Guild | null): Promise<Buffer | null> {
  if (game.state !== 'scored' || !game.winners?.length) return null;
  try {
    const ids = [...(game.winners || []), ...(game.losers || [])];
    const [users, ranks] = await Promise.all([
      User.find({ discordId: { $in: ids } })
        .select({ discordId: 1, ign: 1, elo: 1, recentGames: { $elemMatch: { gameId: game.gameId } } })
        .lean() as unknown as Promise<Array<{ discordId: string; ign?: string; elo?: number; recentGames?: RecentEntry[] }>>,
      EloRank.find().select('roleId startElo endElo').lean() as unknown as Promise<Array<{ roleId: string; startElo: number; endElo: number }>>,
    ]);
    const byId = new Map(users.map(u => [u.discordId, u]));

    const player = (id: string): ScoredPlayer => {
      const user = byId.get(id);
      const entry = user?.recentGames?.[0];
      const gain = typeof entry?.eloGain === 'number' ? entry.eloGain : 0;
      const after = typeof entry?.elo_after === 'number' ? entry.elo_after : (user?.elo ?? 0);
      return {
        discordId: id,
        ign: user?.ign || 'Unknown',
        eloBefore: typeof entry?.elo_before === 'number' ? entry.elo_before : after - gain,
        eloAfter: after,
        kills: entry?.kills ?? 0,
        deaths: entry?.deaths ?? 0,
        diamonds: entry?.diamonds ?? 0,
        mvp: (game.mvps || []).includes(id),
        bedBreaker: (game.bedbreaks || []).includes(id),
      };
    };

    return await renderScoredGame({
      gameId: game.gameId,
      map: game.map,
      startTime: game.startTime,
      endTime: game.endTime,
      winners: (game.winners || []).map(player),
      losers: (game.losers || []).map(player),
    }, ranks, guild);
  } catch (error) {
    console.error(`[GameResultImage] Could not build the result image for game ${game.gameId}:`, error);
    return null;
  }
}
