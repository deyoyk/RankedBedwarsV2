import { loadAvatarDataUrl, staticImageDataUrl } from '../assets/assets';
import { renderPng } from '../assets/renderer';
import { leaderboardTemplate, LeaderboardTemplateEntry } from '../assets/games/leaderboard';
import config from '../config/config';

export interface LeaderboardEntry {
  rank: number;
  ign: string;
  value: string | number;
  elo?: number;
  rankName?: string;
  rankColor?: string;
}

const LEADERBOARD_IMAGE_TIMEOUT_MS = Math.max(
  1000,
  Math.min(
    30000,
    Number.parseInt(process.env.IMAGE_LEADERBOARD_TIMEOUT_MS ?? '', 10) || 10000,
  ),
);

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

export async function generateLeaderboardImage(
  title: string,
  categoryLabel: string,
  entries: LeaderboardEntry[],
  page = 0,
  totalPages?: number
): Promise<Buffer> {
  const rows: LeaderboardTemplateEntry[] = await Promise.all(
    entries.slice(0, 10).map(async entry => ({
      rank: entry.rank,
      ign: entry.ign,
      value: typeof entry.value === 'number' ? entry.value.toLocaleString() : String(entry.value),
      avatar: await resolveAvatar(entry.ign),
      rankName: entry.rankName || 'Unranked',
      rankColor: entry.rankColor || '#6B7174',
    })),
  );

  const tpl = leaderboardTemplate({
    title,
    categoryLabel,
    entries: rows,
    page,
    totalPages,
    serverName: config.serverName,
    inviteLink: config.inviteLink,
  });

  return renderPng(tpl.root, tpl.width, tpl.height, {
    timeoutMs: LEADERBOARD_IMAGE_TIMEOUT_MS,
    priority: 'high',
  });
}
