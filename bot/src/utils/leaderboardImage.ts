import { loadAvatarDataUrl, staticImageDataUrl } from '../assets/assets';
import { renderPng } from '../assets/renderer';
import { leaderboardTemplate, LeaderboardTemplateEntry } from '../assets/games/leaderboard';
import config from '../config/config';
import { getDivisionTag } from './divisionTags';

export interface LeaderboardEntry {
  rank: number;
  ign: string;
  value: string | number;
  elo?: number;
  rankName?: string;
  rankColor?: string;
  discordId?: string;
}

const LEADERBOARD_IMAGE_TIMEOUT_MS = Math.max(
  1000,
  Math.min(
    30000,
    Number.parseInt(process.env.IMAGE_LEADERBOARD_TIMEOUT_MS ?? '', 10) || 10000,
  ),
);

async function resolveAvatar(username: string): Promise<string> {
  try {
    return await loadAvatarDataUrl(username);
  } catch {
    return staticImageDataUrl('fallbacks', 'steve.png');
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
      divisionTag: await getDivisionTag(entry.discordId),
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
