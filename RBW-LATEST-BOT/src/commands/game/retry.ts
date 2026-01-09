import { Message, ChatInputCommandInteraction } from 'discord.js';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

 

const retryCounts: Record<number, number> = {};

export async function retry(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  let gameId: number;
  const Game = (await import('../../models/Game')).default;
  const channelId = (interaction as any).channelId;
  const game = await Game.findOne({ 'channels.text': channelId });
  if (!game) {
    await safeReply(interaction, errorEmbed('No game associated with this channel.', 'Error'));
    return;
  }
  gameId = game.gameId;
  if ((retryCounts[gameId] = (retryCounts[gameId] || 0) + 1) > 2) {
    await safeReply(interaction, errorEmbed(`Game \`${gameId}\` has already been retried twice.`, 'Error'));
    return;
  }
  try {
    if (!wsManager) throw new Error('WebSocketManager instance required for retry.');
    const User = (await import('../../models/User')).default;
    const allIds = [...(game.team1 || []), ...(game.team2 || [])];
    const users = await User.find({ discordId: { $in: allIds } });
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
  } catch (error) {
    await safeReply(interaction, errorEmbed('An error occurred while retrying the game.', 'Error'));
  }
}