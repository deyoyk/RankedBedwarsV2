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

export type PlayerLine = {
  discordId: string;
  username: string;
  team: 'winning' | 'losing';
  elo_before: number;
  elo_after: number;
  oldElo?: number;
  newElo?: number;
  mvp: boolean;
  bedbreaker?: boolean;
  kills?: number;
  deaths?: number;
  kdr?: string | number;
  diamonds?: number;
  emeralds?: number;
  partyId?: string;
};

async function resolveAvatar(username: string): Promise<string> {
  try {
    return await loadAvatarDataUrl(username);
  } catch {
    return staticImageDataUrl('fallbacks', 'steve.png');
  }
}

async function toTemplatePlayer(player: PlayerLine): Promise<ScoreTemplatePlayer> {
  const avatar = await resolveAvatar(player.username);
  const kills = player.kills ?? 0;
  const deaths = player.deaths ?? 0;
  const kdrNum = typeof player.kdr === 'number'
    ? player.kdr
    : typeof player.kdr === 'string' && player.kdr.trim() !== ''
      ? Number(player.kdr)
      : NaN;
  const kdr = Number.isFinite(kdrNum) ? kdrNum.toFixed(2) : (deaths > 0 ? kills / deaths : kills).toFixed(2);

  return {
    username: player.username,
    avatar,
    kills,
    deaths,
    kdr,
    diamonds: player.diamonds ?? 0,
    emeralds: player.emeralds ?? 0,
    partyId: player.partyId,
    eloBefore: player.elo_before ?? player.oldElo ?? 0,
    eloAfter: player.elo_after ?? player.newElo ?? 0,
    mvp: player.mvp,
    bedbreaker: player.bedbreaker ?? false,
  };
}

export async function generateScoreImageBuffer(
  gameId: number,
  winners: PlayerLine[],
  losers: PlayerLine[],
  options?: {
    serverName?: string;
    inviteLink?: string;
    isRanked?: boolean;
    minElo?: number;
    maxElo?: number;
    map?: string;
    date?: string;
    scoredAt?: string;
    duration?: string;
    mode?: string;
  }
): Promise<Buffer> {
  const [winnerRows, loserRows] = await Promise.all([
    Promise.allSettled(winners.map(toTemplatePlayer)),
    Promise.allSettled(losers.map(toTemplatePlayer)),
  ]).then(([winnersSettled, losersSettled]) => {
    const fallback = (username: string): ScoreTemplatePlayer => ({
      username,
      avatar: staticImageDataUrl('fallbacks', 'steve.png'),
      kills: 0,
      deaths: 0,
      kdr: '0.00',
      diamonds: 0,
      emeralds: 0,
      eloBefore: 0,
      eloAfter: 0,
      mvp: false,
      bedbreaker: false,
    });
    return [
      winnersSettled.map((r, i) => (r.status === 'fulfilled' ? r.value : fallback(winners[i].username))),
      losersSettled.map((r, i) => (r.status === 'fulfilled' ? r.value : fallback(losers[i].username))),
    ];
  });
  const serverName = options?.serverName || process.env.SERVER_NAME || '';
  const inviteLink = options?.inviteLink || process.env.INVITE_LINK || '';
  const now = new Date();
  const tpl = scoreTemplate({
    gameId,
    winners: winnerRows,
    losers: loserRows,
    map: options?.map || 'Unknown',
    date: options?.date || now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    scoredAt: options?.scoredAt || `${now.toISOString().slice(11, 16)} UTC`,
    duration: options?.duration || 'N/A',
    mode: options?.mode || (options?.isRanked ? 'RANKED' : 'CASUAL'),
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


