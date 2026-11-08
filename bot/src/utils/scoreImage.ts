import { loadAvatarDataUrl, staticImageDataUrl } from '../assets/assets';
import { renderPng } from '../assets/renderer';
import { scoreTemplate, ScoreTemplatePlayer } from '../assets/games/score';
import { startTemplate, StartTemplatePlayer } from '../assets/games/start';
import User from '../models/User';

const GAME_IMAGE_TIMEOUT_MS = Math.max(
  1000,
  Math.min(
    30000,
    Number.parseInt(process.env.IMAGE_GAME_TIMEOUT_MS ?? '', 10) || 8000,
  ),
);

type PlayerLine = {
  discordId: string;
  username: string;
  team: 'winning' | 'losing';
  elo_before: number;
  elo_after: number;
  oldElo?: number;
  newElo?: number;
  mvp: boolean;
  bedbreaker?: boolean;
};

async function resolveAvatar(username: string): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const fallback = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(staticImageDataUrl('fallbacks', 'steve.png')), 1500);
  });
  try {
    return await Promise.race([loadAvatarDataUrl(username), fallback]);
  } catch {
    return staticImageDataUrl('fallbacks', 'steve.png');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function toTemplatePlayer(player: PlayerLine): Promise<ScoreTemplatePlayer> {
  const avatar = await resolveAvatar(player.username);
  return {
    username: player.username,
    elo_before: player.elo_before ?? player.oldElo ?? 0,
    elo_after: player.elo_after ?? player.newElo ?? 0,
    oldElo: player.elo_before ?? player.oldElo ?? 0,
    newElo: player.elo_after ?? player.newElo ?? 0,
    mvp: player.mvp,
    bedbreaker: player.bedbreaker ?? false,
    avatar,
  };
}

export async function generateScoreImageBuffer(
  gameId: number,
  winners: PlayerLine[],
  losers: PlayerLine[],
  options?: { serverName?: string; inviteLink?: string; isRanked?: boolean; minElo?: number; maxElo?: number }
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
      bedbreaker: false,
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
    isRanked: options?.isRanked === true,
    minElo: options?.minElo ?? 0,
    maxElo: options?.maxElo ?? 0,
    serverName,
    inviteLink,
  });
  return renderPng(tpl.root, tpl.width, tpl.height, {
    timeoutMs: GAME_IMAGE_TIMEOUT_MS,
    priority: 'high',
  });
}

export type GameStartPlayerInput = {
  discordId: string;
  username: string;
  elo: number;
  isCaptain: boolean;
};

export async function fetchGameStartRoster(playerIds: string[]): Promise<Map<string, GameStartPlayerInput>> {
  const roster = new Map<string, GameStartPlayerInput>();
  try {
    const ids = [...new Set((playerIds ?? []).filter(id => typeof id === 'string' && id.length > 0))];
    if (ids.length === 0) return roster;
    const users = await User.find({ discordId: { $in: ids } }).select('discordId ign elo').lean() as Array<{ discordId?: string; ign?: string; elo?: number }>;
    for (const user of users ?? []) {
      if (!user || typeof user.discordId !== 'string') continue;
      roster.set(user.discordId, {
        discordId: user.discordId,
        username: typeof user.ign === 'string' && user.ign.length > 0 ? user.ign : user.discordId,
        elo: typeof user.elo === 'number' ? user.elo : 0,
        isCaptain: false,
      });
    }
    for (const id of ids) {
      if (!roster.has(id)) {
        roster.set(id, { discordId: id, username: id, elo: 0, isCaptain: false });
      }
    }
  } catch (error) {
    console.error('[ScoreImage] Error fetching game start roster:', error);
  }
  return roster;
}

export async function generateGameStartImageBuffer(
  gameId: number,
  team1: GameStartPlayerInput[],
  team2: GameStartPlayerInput[],
  options: { mapName: string; modeLabel: string; serverName?: string; inviteLink?: string; isRanked?: boolean; minElo?: number; maxElo?: number }
): Promise<Buffer> {
  const toStartPlayer = async (p: GameStartPlayerInput): Promise<StartTemplatePlayer> => ({
    username: p.username,
    elo: p.elo,
    isCaptain: p.isCaptain,
    avatar: await resolveAvatar(p.username),
  });
  const [team1Rows, team2Rows] = await Promise.all([
    Promise.all(team1.map(toStartPlayer)),
    Promise.all(team2.map(toStartPlayer)),
  ]);
  const avg = (team: StartTemplatePlayer[]): number => {
    if (team.length === 0) return 0;
    return Math.round(team.reduce((sum, p) => sum + (p.elo || 0), 0) / team.length);
  };
  const serverName = options?.serverName || process.env.SERVER_NAME || '';
  const inviteLink = options?.inviteLink || process.env.INVITE_LINK || '';
  const tpl = startTemplate({
    gameId,
    mapName: options?.mapName || 'Unknown Map',
    modeLabel: options?.modeLabel || '',
    team1: team1Rows,
    team2: team2Rows,
    team1Avg: avg(team1Rows),
    team2Avg: avg(team2Rows),
    isRanked: options?.isRanked === true,
    minElo: options?.minElo ?? 0,
    maxElo: options?.maxElo ?? 0,
    serverName,
    inviteLink,
  });
  return renderPng(tpl.root, tpl.width, tpl.height, {
    timeoutMs: GAME_IMAGE_TIMEOUT_MS,
    priority: 'high',
  });
}

export type { PlayerLine };
