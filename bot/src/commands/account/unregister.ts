import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import User from '../../models/User';
import { safeFix } from '../../utils/fix';

const { errorEmbed, successEmbed } = embedsFor('Admin');

export async function unregister(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let targetUserId: string;

  
    const user = interaction.options.getUser('user', true);
    targetUserId = user.id;
  

  try {
    const result = await User.deleteOne({ discordId: targetUserId });
    if (result.deletedCount === 0) {
      await safeReply(interaction, errorEmbed('User not found in the database.', 'Unregister Error'));
      return;
    }
    
    
    await safeFix(interaction.guild, targetUserId);
    
    await safeReply(interaction, successEmbed(`User <@${targetUserId}> has been removed from the database.`, 'User Unregistered'));
  } catch (error) {
    await replyCommandError(interaction, error, 'remove the user', '[unregister]');
  }
}