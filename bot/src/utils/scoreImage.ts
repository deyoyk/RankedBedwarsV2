import { loadAvatarDataUrl } from '../images/assets';
import { renderPng } from '../images/renderer';
import { scoreTemplate, ScoreTemplatePlayer } from '../images/templates/score';

type PlayerLine = {
  discordId: string;
  username: string;
  team: 'winning' | 'losing';
  elo_before: number;
  elo_after: number;
  oldElo?: number;
  newElo?: number;
  mvp: boolean;
};

async function toTemplatePlayer(player: PlayerLine): Promise<ScoreTemplatePlayer> {
  return {
    username: player.username,
    elo_before: player.elo_before ?? player.oldElo ?? 0,
    elo_after: player.elo_after ?? player.newElo ?? 0,
    oldElo: player.elo_before ?? player.oldElo ?? 0,
    newElo: player.elo_after ?? player.newElo ?? 0,
    mvp: player.mvp,
    avatar: await loadAvatarDataUrl(player.username),
  };
}

export async function generateScoreImageBuffer(
  gameId: number,
  winners: PlayerLine[],
  losers: PlayerLine[],
  options?: { serverName?: string; inviteLink?: string }
): Promise<Buffer> {
  const [winnerRows, loserRows] = await Promise.all([
    Promise.all(winners.map(toTemplatePlayer)),
    Promise.all(losers.map(toTemplatePlayer)),
  ]);
  const serverName = options?.serverName || process.env.SERVER_NAME || '';
  const inviteLink = options?.inviteLink || process.env.INVITE_LINK || '';
  const tpl = scoreTemplate({
    gameId,
    winners: winnerRows,
    losers: loserRows,
    serverName,
    inviteLink,
  });
  return renderPng(tpl.root, tpl.width, tpl.height);
}

export type { PlayerLine };
