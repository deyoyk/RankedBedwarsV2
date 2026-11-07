import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import EloRank from '../../models/EloRank';
import { safeReply } from '../../utils/safeReply';

export async function removeelo(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let roleId: string;

  
    roleId = interaction.options.getString('role_id', true);
  

  try {
    const rank = await EloRank.findOneAndDelete({ roleId });

    if (!rank) {
      await safeReply(interaction, errorEmbed('No ELO rank found with the specified role ID.', 'ELO Rank Removal Error'));
      return;
    }

    const embed = successEmbed('The ELO rank has been successfully removed!', 'ELO Rank Removed');
    embed.builder.addFields(
      { name: 'Role', value: `<@&${roleId}>`, inline: true },
      { name: 'ELO Range', value: `${rank.startElo}-${rank.endElo}`, inline: true }
    );
    await safeReply(interaction, embed);
  } catch (error) {
    console.error('Error in removeelo command:', error);
    await safeReply(interaction, errorEmbed('There was an error removing the ELO rank.', 'ELO Rank Removal Error'));
  }
}