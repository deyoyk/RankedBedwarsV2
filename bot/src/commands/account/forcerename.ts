import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import User from '../../models/User';
import { safeFix } from '../../utils/fix';
import { isValidIgn } from '../../utils/inputValidation';

export async function forcerename(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const user = interaction.options.getUser('user');
  if (!user) {
    await safeReply(interaction, errorEmbed('Please provide a valid user.', 'Force Rename Error'));
    return;
  }
  const targetUser = user.id;
  const newIgn = interaction.options.getString('new_ign', true);

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
      { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true }
    );
    await safeReply(interaction, embed);

  } catch (error) {
    console.error('Error in forcerename command:', error);
    await safeReply(interaction, errorEmbed('There was an error renaming the user.', 'Force Rename Error'));
  }
}