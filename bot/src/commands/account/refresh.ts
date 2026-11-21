import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { fix } from '../../utils/fix';
import { embedsFor } from '../../utils/betterembed';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';

const { errorEmbed, successEmbed } = embedsFor('Player');

export async function refresh(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const userId = interaction.user.id;
  if (!interaction.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Refresh Error'));
    return;
  }
  try {
    await fix(interaction.guild, userId);
    await safeReply(interaction, successEmbed('Your nickname and roles have been refreshed.', 'Refreshed'));
  } catch (error) {
    await replyCommandError(interaction, error, 'refresh your nickname and roles', '[refresh]');
  }
}