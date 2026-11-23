import { generateScoreImageBuffer, PlayerLine } from './scoreImage';

export interface ScoredPlayer {
  discordId: string;
  ign: string;
  eloBefore: number;
  eloAfter: number;
  kills: number;
  deaths: number;
  diamonds: number;
  emeralds?: number;
  partyId?: string;
  mvp: boolean;
  bedBreaker: boolean;
}

export interface ScoredGame {
  gameId: number;
  map?: string;
  startTime?: Date | string;
  endTime?: Date | string;
  isRanked?: boolean;
  minElo?: number;
  maxElo?: number;
  winners: ScoredPlayer[];
  losers: ScoredPlayer[];
}

function formatDuration(start?: Date | string, end?: Date | string): string {
  if (!start || !end) return 'N/A';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!(ms > 0)) return 'N/A';
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export async function renderScoredGame(game: ScoredGame): Promise<Buffer> {
  const toLine = (p: ScoredPlayer, team: 'winning' | 'losing'): PlayerLine => ({
    discordId: p.discordId,
    username: p.ign,
    team,
    elo_before: p.eloBefore,
    elo_after: p.eloAfter,
    oldElo: p.eloBefore,
    newElo: p.eloAfter,
    mvp: p.mvp,
    bedbreaker: p.bedBreaker,
    kills: p.kills,
    deaths: p.deaths,
    diamonds: p.diamonds,
    emeralds: p.emeralds ?? 0,
    partyId: p.partyId,
    kdr: p.deaths > 0 ? p.kills / p.deaths : p.kills,
  });

  const end = game.endTime ? new Date(game.endTime) : new Date();

  return generateScoreImageBuffer(
    game.gameId,
    game.winners.map(p => toLine(p, 'winning')),
    game.losers.map(p => toLine(p, 'losing')),
    {
      map: game.map,
      date: end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      scoredAt: `${end.toISOString().slice(11, 16)} UTC`,
      duration: formatDuration(game.startTime, game.endTime),
      mode: game.isRanked ? 'RANKED' : 'CASUAL',
      isRanked: game.isRanked ?? false,
      minElo: game.minElo ?? 0,
      maxElo: game.maxElo ?? 0,
    },
  );
}
