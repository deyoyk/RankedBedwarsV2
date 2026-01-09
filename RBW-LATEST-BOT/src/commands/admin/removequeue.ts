import { Message, ChatInputCommandInteraction } from 'discord.js';
import { betterEmbed, errorEmbed, successEmbed } from '../../utils/betterembed';
import Queue from '../../models/Queue';
import { safeReply } from '../../utils/safeReply';


export async function removequeue(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let channelId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    channelId = interaction.options.getString('channelid', true);
  } else {
    if (!args || args.length !== 1) {
      await safeReply(interaction, errorEmbed('Usage: =removequeue <channelId>', 'Queue Removal Error'));
      return;
    }
    channelId = args[0];
  }

  try {
    const queue = await Queue.findOneAndDelete({ channelId });

    if (!queue) {
      await safeReply(interaction, errorEmbed('No queue found with the specified channel ID.', 'Queue Removal Error'));
      return;
    }

    const embed = successEmbed('The queue has been successfully removed!', 'Queue Removed');
    embed.builder.addFields(
      { name: 'Channel ID', value: channelId, inline: true },
      { name: 'Max Players', value: queue.maxPlayers.toString(), inline: true },
      { name: 'ELO Range', value: `${queue.minElo}-${queue.maxElo}`, inline: true },
      { name: 'Queue Type', value: queue.isRanked ? 'Ranked' : 'Casual', inline: true },
      { name: 'Picking Enabled', value: queue.ispicking ? 'Yes' : 'No', inline: true }
    );
    await safeReply(interaction, embed);
  } catch (error) {
    console.error('Error in removequeue command:', error);
    await safeReply(interaction, errorEmbed('There was an error removing the queue.', 'Queue Removal Error'));
  }
}