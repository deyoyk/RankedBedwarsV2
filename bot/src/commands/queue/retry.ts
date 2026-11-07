import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { queueSystemEmbed } from '../../utils/queueEmbed';

export async function retry(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  void args;
  const Game = (await import('../../models/Game')).default;
  const channelId = interaction.channelId;
  const game = await Game.findOne({ 'channels.text': channelId })
    .select('gameId state')
    .lean();

  if (!game) {
    await safeReply(interaction, { embeds: [queueSystemEmbed('No game associated with this channel.', 'error')] });
    return;
  }
  if (game.state !== 'pending') {
    await safeReply(interaction, { embeds: [queueSystemEmbed(`Game \`${game.gameId}\` is ${game.state} and can no longer be retried.`, 'error')] });
    return;
  }

  const resolvedWs = wsManager ?? (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
  if (!resolvedWs) {
    await safeReply(interaction, { embeds: [queueSystemEmbed('WebSocket manager is not available.', 'error')] });
    return;
  }

  const gameManager = resolvedWs.getGameManager?.();
  if (!gameManager || typeof gameManager.retryWarp !== 'function') {
    await safeReply(interaction, { embeds: [queueSystemEmbed('Game manager is not available.', 'error')] });
    return;
  }

  try {
    const result = await gameManager.retryWarp(game.gameId);
    await safeReply(interaction, {
      embeds: [queueSystemEmbed(`Retry sent for game \`${game.gameId}\` (attempt ${result.attempts}/${result.maxAttempts}).`, 'success')]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An error occurred while retrying the game.';
    await safeReply(interaction, { embeds: [queueSystemEmbed(message, 'error')] });
  }
}
