import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import User from '../../models/User';
import { safeFix } from '../../utils/fix';
import { parseDiscordId, isValidIgn } from '../../utils/inputValidation';



export async function forcerename(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUser: string | null;
  let newIgn: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetUser = user.id;
    newIgn = interaction.options.getString('new_ign', true);
  } else {
    if (!args || args.length < 2) {
      await safeReply(interaction, errorEmbed('Usage: =forcerename <user> <newign>', 'Force Rename Error'));
      return;
    }
    targetUser = parseDiscordId(args[0]);
    if (!targetUser) {
      await safeReply(interaction, errorEmbed('Please mention a valid user or ID.', 'Force Rename Error'));
      return;
    }
    newIgn = args[1];
  }

  if (!isValidIgn(newIgn)) {
    await safeReply(interaction, errorEmbed('IGN must be 3-16 characters of letters, numbers or underscores.', 'Force Rename Error'));
    return;
  }

  try {
    const updated = await User.findOneAndUpdate(
      { discordId: targetUser },
      { $set: { ign: newIgn } },
      { new: false }
    ).select('ign').lean();
    if (!updated) {
      await safeReply(interaction, errorEmbed(`User <@${targetUser}> is not registered. Use \`forceregister\` instead.`, '❌ Force Rename Error'));
      return;
    }

    const oldIgn = updated.ign;

    await safeFix(interaction.guild, targetUser);

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