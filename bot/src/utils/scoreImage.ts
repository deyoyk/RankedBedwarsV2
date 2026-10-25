import { loadAvatarDataUrl, staticImageDataUrl } from '../images/assets';
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
  const avatar = await Promise.race([
    loadAvatarDataUrl(player.username),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(staticImageDataUrl('fallbacks', 'steve.png')), 1500)
    )
  ]).catch(() => staticImageDataUrl('fallbacks', 'steve.png'));
  return {
    username: player.username,
    elo_before: player.elo_before ?? player.oldElo ?? 0,
    elo_after: player.elo_after ?? player.newElo ?? 0,
    oldElo: player.elo_before ?? player.oldElo ?? 0,
    newElo: player.elo_after ?? player.newElo ?? 0,
    mvp: player.mvp,
    avatar,
  };
}

export async function generateScoreImageBuffer(
  gameId: number,
  winners: PlayerLine[],
  losers: PlayerLine[],
  options?: { serverName?: string; inviteLink?: string }
): Promise<Buffer> {
  const [winnerRows, loserRows] = await Promise.all([
    Promise.allSettled(winners.map(toTemplatePlayer)),
    Promise.allSettled(losers.map(toTemplatePlayer)),
  ]).then(([winnersSettled, losersSettled]) => {
    const fallback = (username: string): ScoreTemplatePlayer => ({
      username,
      elo_before: 0,
      elo_after: 0,
      oldElo: 0,
      newElo: 0,
      mvp: false,
      avatar: staticImageDataUrl('fallbacks', 'steve.png'),
    });
    return [
      winnersSettled.map((r, i) => (r.status === 'fulfilled' ? r.value : fallback(winners[i].username))),
      losersSettled.map((r, i) => (r.status === 'fulfilled' ? r.value : fallback(losers[i].username))),
    ];
  });
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
