import { ChatInputCommandInteraction } from 'discord.js';
import Game from '../../models/Game';
import { getSharedGameManager } from '../../Matchmaking/sharedGameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

export async function forcevoid(interaction: ChatInputCommandInteraction, wsManager?: WebSocketManager) {
  
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased()) {
    await safeReply(interaction, errorEmbed('This command can only be used in a game thread.', 'Error'));
    return;
  }

  
  const game = await Game.findOne({ 'channels.text': channel.id }).select('state gameId').lean();
  if (!game) {
    await safeReply(interaction, errorEmbed('No game is associated with this channel.', 'Error'));
    return;
  }

  if (game.state === 'voided') {
    await safeReply(interaction, errorEmbed('game is already voided bruh', 'Error'));
    return;
  }

  let reason: string;
  
    reason = `force voided by <@${interaction.user.id}>`;
  

  try {
    const resolvedWs = wsManager ?? (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
    if (!resolvedWs) {
      await safeReply(interaction, errorEmbed('WebSocket manager not available.', 'Error'));
      return;
    }
    
    const gameManager = getSharedGameManager(interaction.client, resolvedWs!);
    await gameManager.voidGame(game.gameId, reason);
    
    
      await safeReply(interaction, successEmbed(
        `Game ${game.gameId} has been force voided.\nReason: ${reason}\nStats and ELO changes have been reverted. Game threads will be archived in 30 seconds.`,
        'Game Force Voided',
        true
      ));
    
  } catch (error) {
    console.error('Error in forcevoid command:', error);
    
      await safeReply(interaction, errorEmbed(
        'There was an error force voiding the game.',
        'Error',
        true
      ));
    
  }
}