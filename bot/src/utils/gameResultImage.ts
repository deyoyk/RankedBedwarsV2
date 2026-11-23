import Queue from '../models/Queue';
import User from '../models/User';
import { renderScoredGame, ScoredPlayer } from './scoredGameImage';

interface ResultGame {
  gameId: number;
  state?: string;
  queueId?: string;
  isRanked?: boolean;
  map?: string;
  winners?: string[];
  losers?: string[];
  mvps?: string[];
  bedbreaks?: string[];
  startTime?: Date | string;
  endTime?: Date | string;
}

interface RecentEntry {
  eloGain?: number;
  elo_before?: number;
  elo_after?: number;
  kills?: number;
  deaths?: number;
  diamonds?: number;
  emeralds?: number;
}

export function formatGameDuration(game: { startTime?: Date | string; endTime?: Date | string }): string | null {
  if (!game.startTime || !game.endTime) return null;
  const total = Math.max(0, Math.floor((new Date(game.endTime).getTime() - new Date(game.startTime).getTime()) / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

export async function buildGameResultImage(game: ResultGame): Promise<Buffer | null> {
  if (game.state !== 'scored' || !game.winners?.length) return null;
  try {
    const ids = [...(game.winners || []), ...(game.losers || [])];
    const [users, queue] = await Promise.all([
      User.find({ discordId: { $in: ids } })
        .select({ discordId: 1, ign: 1, elo: 1, partyId: 1, recentGames: { $elemMatch: { gameId: game.gameId } } })
        .lean() as unknown as Promise<Array<{ discordId: string; ign?: string; elo?: number; partyId?: string; recentGames?: RecentEntry[] }>>,
      game.queueId
        ? Queue.findOne({ channelId: game.queueId }).select('isRanked minElo maxElo').lean().catch(() => null) as Promise<{ isRanked?: boolean; minElo?: number; maxElo?: number } | null>
        : Promise.resolve(null),
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
        emeralds: entry?.emeralds ?? 0,
        partyId: user?.partyId,
        mvp: (game.mvps || []).includes(id),
        bedBreaker: (game.bedbreaks || []).includes(id),
      };
    };

    return await renderScoredGame({
      gameId: game.gameId,
      map: game.map,
      startTime: game.startTime,
      endTime: game.endTime,
      isRanked: queue?.isRanked ?? game.isRanked === true,
      minElo: queue?.minElo ?? 0,
      maxElo: queue?.maxElo ?? 0,
      winners: (game.winners || []).map(player),
      losers: (game.losers || []).map(player),
    });
  } catch (error) {
    console.error(`[GameResultImage] Could not build the result image for game ${game.gameId}:`, error);
    return null;
  }
}
