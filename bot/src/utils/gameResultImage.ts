import Queue from '../models/Queue';
import User from '../models/User';
import { generateScoreImageBuffer, PlayerLine } from './scoreImage';

interface ResultGame {
  gameId: number;
  state?: string;
  queueId?: string;
  isRanked?: boolean;
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

/**
 * The same result image the scoring post shows, rebuilt from the stored game for /gameinfo.
 * Null for games that were never scored (in progress or voided before scoring).
 */
export async function buildGameResultImage(game: ResultGame): Promise<Buffer | null> {
  if (game.state !== 'scored' || !game.winners?.length) return null;
  try {
    const ids = [...(game.winners || []), ...(game.losers || [])];
    const users = await User.find({ discordId: { $in: ids } })
      .select({ discordId: 1, ign: 1, elo: 1, recentGames: { $elemMatch: { gameId: game.gameId } } })
      .lean() as Array<{ discordId: string; ign?: string; elo?: number; recentGames?: Array<{ eloGain?: number; elo_before?: number; elo_after?: number }> }>;
    const byId = new Map(users.map(u => [u.discordId, u]));

    const line = (id: string, team: 'winning' | 'losing'): PlayerLine => {
      const user = byId.get(id);
      const entry = user?.recentGames?.[0];
      const gain = typeof entry?.eloGain === 'number' ? entry.eloGain : 0;
      // Older entries have no before/after: fall back to the player's current ELO
      const after = typeof entry?.elo_after === 'number' ? entry.elo_after : (user?.elo ?? 0);
      const before = typeof entry?.elo_before === 'number' ? entry.elo_before : after - gain;
      return {
        discordId: id,
        username: user?.ign || 'Unknown',
        team,
        elo_before: before,
        elo_after: after,
        mvp: (game.mvps || []).includes(id),
        bedbreaker: (game.bedbreaks || []).includes(id),
      };
    };

    const queue = game.queueId
      ? await Queue.findOne({ channelId: game.queueId }).select('isRanked minElo maxElo').lean().catch(() => null) as { isRanked?: boolean; minElo?: number; maxElo?: number } | null
      : null;
    return await generateScoreImageBuffer(
      game.gameId,
      (game.winners || []).map(id => line(id, 'winning')),
      (game.losers || []).map(id => line(id, 'losing')),
      { isRanked: queue?.isRanked ?? game.isRanked === true, minElo: queue?.minElo ?? 0, maxElo: queue?.maxElo ?? 0 },
    );
  } catch (error) {
    console.error(`[GameResultImage] Could not build the result image for game ${game.gameId}:`, error);
    return null;
  }
}
