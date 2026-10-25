import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import User from '../../models/User';
import { safeFix } from '../../utils/fix';


export async function unregister(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUserId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetUserId = user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =unregister <@user>', 'Unregister Error'));
      return;
    }
    const userArg = args[0];
    const userMatch = userArg.match(/^<@!?([0-9]+)>$/) || userArg.match(/^([0-9]+)$/);
    if (!userMatch) {
      await safeReply(interaction, errorEmbed('Please provide a valid user mention or ID.', 'Unregister Error'));
      return;
    }
    targetUserId = userMatch[1];
  }

  try {
    const result = await User.deleteOne({ discordId: targetUserId });
    if (result.deletedCount === 0) {
      await safeReply(interaction, errorEmbed('User not found in the database.', 'Unregister Error'));
      return;
    }
    
    
    await safeFix(interaction.guild, targetUserId);
    
    await safeReply(interaction, successEmbed(`User <@${targetUserId}> has been removed from the database.`, 'User Unregistered'));
  } catch (error) {
    console.error('Error in unregister command:', error);
    await safeReply(interaction, errorEmbed('There was an error removing the user.', 'Unregister Error'));
  }
}