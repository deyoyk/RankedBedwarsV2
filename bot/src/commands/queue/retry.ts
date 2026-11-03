import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

export async function retry(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  void args;
  const Game = (await import('../../models/Game')).default;
  const channelId = interaction.channelId;
  const game = await Game.findOne({ 'channels.text': channelId })
    .select('gameId state')
    .lean();

  if (!game) {
    await safeReply(interaction, errorEmbed('No game associated with this channel.', 'Retry Error'));
    return;
  }
  if (game.state !== 'pending') {
    await safeReply(interaction, errorEmbed(`Game \`${game.gameId}\` is ${game.state} and can no longer be retried.`, 'Retry Error'));
    return;
  }

  const resolvedWs = wsManager ?? (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
  if (!resolvedWs) {
    await safeReply(interaction, errorEmbed('WebSocket manager is not available.', 'Retry Error'));
    return;
  }

  const gameManager = resolvedWs.getGameManager?.();
  if (!gameManager || typeof gameManager.retryWarp !== 'function') {
    await safeReply(interaction, errorEmbed('Game manager is not available.', 'Retry Error'));
    return;
  }

  try {
    const result = await gameManager.retryWarp(game.gameId);
    await safeReply(interaction, successEmbed(
      `Retry sent for game \`${game.gameId}\` (attempt ${result.attempts}/${result.maxAttempts}).`,
      'Retry Initiated',
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An error occurred while retrying the game.';
    await safeReply(interaction, errorEmbed(message, 'Retry Error'));
  }
}
