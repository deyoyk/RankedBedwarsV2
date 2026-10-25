import { Message, ChatInputCommandInteraction } from 'discord.js';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

 

const retryCounts: Record<number, { count: number; at: number }> = {};
const RETRY_RECORD_TTL_MS = 60 * 60 * 1000;
const MAX_TRACKED_RETRIES = 5000;

export async function retry(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  const Game = (await import('../../models/Game')).default;
  const channelId = interaction.channelId;
  const game = await Game.findOne({ 'channels.text': channelId }).select('gameId state map isRanked team1 team2').lean();
  if (!game) {
    await safeReply(interaction, errorEmbed('No game associated with this channel.', 'Error'));
    return;
  }
  const gameId = game.gameId;
  if (game.state !== 'pending') {
    await safeReply(interaction, errorEmbed(`Game \`${gameId}\` is ${game.state} and can no longer be retried.`, 'Error'));
    return;
  }
  const now = Date.now();
  const tracked = retryCounts[gameId];
  const attempts = (tracked && now - tracked.at < RETRY_RECORD_TTL_MS ? tracked.count : 0) + 1;
  retryCounts[gameId] = { count: attempts, at: now };
  if (Object.keys(retryCounts).length > MAX_TRACKED_RETRIES) {
    const oldest = Object.keys(retryCounts).slice(0, Object.keys(retryCounts).length - MAX_TRACKED_RETRIES);
    for (const id of oldest) delete retryCounts[Number(id)];
  }
  if (attempts > 2) {
    await safeReply(interaction, errorEmbed(`Game \`${gameId}\` has already been retried twice.`, 'Error'));
    return;
  }
  try {
    if (!wsManager) throw new Error('WebSocketManager instance required for retry.');
    const User = (await import('../../models/User')).default;
    const allIds = [...(game.team1 || []), ...(game.team2 || [])];
    const users = await User.find({ discordId: { $in: allIds } }).select('discordId ign').lean();
    const idToIgn = Object.fromEntries(users.map(u => [u.discordId, u.ign]));
    const team1 = (game.team1 || []).map((id: string) => idToIgn[id] || id);
    const team2 = (game.team2 || []).map((id: string) => idToIgn[id] || id);
    wsManager.send({
      type: 'warp_players',
      game_id: String(game.gameId),
      map: game.map,
      is_ranked: !!game.isRanked,
      team1: { players: team1 },
      team2: { players: team2 }
    });
    await safeReply(interaction, successEmbed(`Retrying game \`${gameId}\``, 'Retry Initiated'));
  } catch {
    await safeReply(interaction, errorEmbed('An error occurred while retrying the game.', 'Error'));
  }
}