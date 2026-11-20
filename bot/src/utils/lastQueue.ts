import User from '../models/User';

/** How long /q in game remembers the last queue someone was in. */
export const LAST_QUEUE_MS = 24 * 60 * 60 * 1000;

/** The queue VC this player was last in, or null when it's been longer than a day. */
export function recentQueueId(
  user: { lastQueueChannelId?: string | null; lastQueueAt?: Date | string | null },
  now: number = Date.now(),
): string | null {
  if (!user.lastQueueChannelId || !user.lastQueueAt) return null;
  const at = new Date(user.lastQueueAt).getTime();
  return Number.isFinite(at) && now - at <= LAST_QUEUE_MS ? user.lastQueueChannelId : null;
}

export async function rememberQueue(discordIds: string[], channelId: string): Promise<void> {
  if (discordIds.length === 0) return;
  try {
    await User.updateMany(
      { discordId: { $in: discordIds } },
      { $set: { lastQueueChannelId: channelId, lastQueueAt: new Date() } },
    );
  } catch (error) {
    console.warn(`[lastQueue] Couldn't save the last queue for ${discordIds.join(', ')}:`, error);
  }
}
