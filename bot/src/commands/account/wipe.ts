import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { embedsFor } from '../../utils/betterembed';
import { safeFix } from '../../utils/fix';
import { safeReply } from '../../utils/safeReply';
import { resetUserStats } from '../../utils/userStats';

const { errorEmbed, successEmbed } = embedsFor('Admin');

export async function wipe(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let targetId: string | undefined;
  let targetMention: string | undefined;

  
    const user = interaction.options.getUser('user', true);
    targetId = user.id;
    targetMention = `<@${user.id}>`;
  

  try {
    const zeroed: Record<string, unknown> = {};
    resetUserStats(zeroed);

    const wiped = await User.findOneAndUpdate(
      { discordId: targetId },
      { $set: zeroed },
      { new: true }
    );
    if (!wiped) {
      await safeReply(interaction, errorEmbed('User not found in the database.', 'Wipe Error'));
      return;
    }

    await safeFix(interaction.guild, wiped.discordId);

    await safeReply(interaction, successEmbed(`All stats for ${targetMention} have been wiped.`, 'Wipe Successful'));
  } catch (error) {
    console.error('Error in wipe command:', error);
    await safeReply(interaction, errorEmbed('There was an error wiping the user stats.', 'Wipe Error'));
  }
}