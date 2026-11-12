import type { Guild } from 'discord.js';
import { generateScoredImage, PlayerLine } from './scoredImage';
import { formatMapName } from './mapName';

export interface ScoredPlayer {
  discordId: string;
  ign: string;
  eloBefore: number;
  eloAfter: number;
  kills: number;
  deaths: number;
  diamonds: number;
  mvp: boolean;
  bedBreaker: boolean;
}

export interface ScoredGame {
  gameId: number;
  map?: string;
  startTime?: Date | string;
  endTime?: Date | string;
  winners: ScoredPlayer[];
  losers: ScoredPlayer[];
}

interface RankRange {
  roleId: string;
  startElo: number;
  endElo: number;
}

function formatDuration(start?: Date | string, end?: Date | string): string {
  if (!start || !end) return 'N/A';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!(ms > 0)) return 'N/A';
  return `${Math.floor(ms / 60000)}:${Math.floor((ms % 60000) / 1000).toString().padStart(2, '0')}`;
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** The scored-game card: the same picture for the score post, the game thread and /gameinfo. */
export async function renderScoredGame(game: ScoredGame, ranks: RankRange[], guild?: Guild | null): Promise<Buffer> {
  const toLine = (p: ScoredPlayer, team: 'winning' | 'losing'): PlayerLine => {
    const rank = ranks.find(r => p.eloAfter >= r.startElo && p.eloAfter <= r.endElo);
    const role = rank ? guild?.roles.cache.get(rank.roleId) : undefined;
    return {
      discordId: p.discordId,
      username: p.ign,
      team,
      oldElo: p.eloBefore,
      newElo: p.eloAfter,
      mvp: p.mvp,
      bedBreaker: p.bedBreaker,
      kills: p.kills,
      deaths: p.deaths,
      diamonds: p.diamonds,
      kdr: p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : String(p.kills),
      rankName: role?.name,
      rankColor: role && role.color !== 0 ? role.hexColor : undefined,
      rankIconUrl: role?.iconURL({ extension: 'png', size: 64 }) ?? null,
    };
  };
  const winners = game.winners.map(p => toLine(p, 'winning'));
  const losers = game.losers.map(p => toLine(p, 'losing'));
  const total = (lines: PlayerLine[]) => lines.reduce((sum, p) => sum + (p.newElo - p.oldElo), 0);

  return generateScoredImage(game.gameId, winners, losers, {
    map: formatMapName(game.map),
    duration: formatDuration(game.startTime, game.endTime),
    date: new Date(game.endTime || Date.now()).toLocaleDateString('en-GB'),
    winnerTeamElo: signed(total(winners)),
    loserTeamElo: String(total(losers)),
  });
}
