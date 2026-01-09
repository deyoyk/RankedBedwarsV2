import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { betterEmbed, errorEmbed, successEmbed } from '../../utils/betterembed';
import User from '../../models/User';
import { fix } from '../../utils/fix';

 

export async function forcerename(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUser: string;
  let newIgn: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetUser = user.id;
    newIgn = interaction.options.getString('newign', true);
  } else {
    if (!args || args.length < 2) {
      await safeReply(interaction, errorEmbed('Usage: =forcerename <user> <newign>', 'Force Rename Error'));
      return;
    }
    targetUser = args[0].replace(/[<@!>]/g, ''); 
    newIgn = args[1];
  }

  try {
    const user = await User.findOne({ discordId: targetUser });
    
    if (!user) {
      await safeReply(interaction, errorEmbed(`User <@${targetUser}> is not registered. Use \`forceregister\` instead.`, '❌ Force Rename Error'));
      return;
    }

    const oldIgn = user.ign;
    user.ign = newIgn;
    await user.save();

    
    if (interaction.guild) {
      try {
        await fix(interaction.guild, targetUser);
      } catch (error) {
        console.error(`Error updating roles/nickname for ${targetUser}:`, error);
      }
    }

    const embed = successEmbed(`Successfully renamed <@${targetUser}>`, '✅ User Force Renamed');
    embed.builder.addFields(
      { name: 'User', value: `<@${targetUser}>`, inline: true },
      { name: 'Previous IGN', value: oldIgn || 'None', inline: true },
      { name: 'New IGN', value: newIgn, inline: true },
      { name: 'Moderator', value: `<@${interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id}>`, inline: true }
    );
    await safeReply(interaction, embed);

  } catch (error) {
    console.error('Error in forcerename command:', error);
    await safeReply(interaction, errorEmbed('There was an error renaming the user.', 'Force Rename Error'));
  }
}