import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { fix } from '../../utils/fix';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

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
    console.error('Error in refresh command:', error);
    await safeReply(interaction, errorEmbed('There was an error refreshing your nickname and roles.', 'Refresh Error'));
  }
}