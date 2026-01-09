import { Message, ChatInputCommandInteraction } from 'discord.js';
import { betterEmbed, errorEmbed, successEmbed } from '../../utils/betterembed';
import EloRank from '../../models/EloRank';
import { safeReply } from '../../utils/safeReply';


export async function removeelo(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let roleId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    roleId = interaction.options.getString('roleid', true);
  } else {
    if (!args || args.length !== 1) {
      await safeReply(interaction, errorEmbed('Usage: =removeelo <roleId>', 'ELO Rank Removal Error'));
      return;
    }
    roleId = args[0];
  }

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