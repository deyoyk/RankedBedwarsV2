import { Message, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import Game from '../../models/Game';
import { GameManager } from '../../Matchmaking/GameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

export async function forcevoid(interaction: Message | ChatInputCommandInteraction) {
  
  const channel = interaction.channel;
  if (!channel || channel.type !== 0) { 
    await safeReply(interaction, errorEmbed('This command can only be used in a game text channel.', 'Error'));
    return;
  }

  
  const game = await Game.findOne({ 'channels.text': channel.id });
  if (!game) {
    await safeReply(interaction, errorEmbed('No game is associated with this channel.', 'Error'));
    return;
  }

  if (game.state === 'voided') {
    await safeReply(interaction, errorEmbed('game is already voided bruh', 'Error'));
    return;
  }

  let reason: string;
  if (interaction instanceof ChatInputCommandInteraction) {
    reason = `force voided by <@${interaction.user.id}>`;
  } else {
    reason = `force voided by <@${interaction.author.id}>`;
  }

  try {
    const wsManager = global._wsManager as WebSocketManager;
    if (!wsManager) {
      await safeReply(interaction, errorEmbed('WebSocket manager not available.', 'Error'));
      return;
    }
    
    const gameManager = new GameManager(interaction.client, wsManager);
    await gameManager.voidGame(game.gameId, reason);
    
    if (interaction instanceof ChatInputCommandInteraction) {
      await safeReply(interaction, successEmbed(
        `Game ${game.gameId} has been force voided.\nReason: ${reason}\nStats and ELO changes have been reverted. Game channels will be deleted in 30 seconds.`,
        'Game Force Voided',
        true
      ));
    } else {
      await safeReply(interaction, successEmbed(
        `Game ${game.gameId} has been force voided.\nReason: ${reason}\nStats and ELO changes have been reverted. Game channels will be deleted in 30 seconds.`,
        'Game Force Voided',
        false
      ));
    }
  } catch (error) {
    console.error('Error in forcevoid command:', error);
    if (interaction instanceof ChatInputCommandInteraction) {
      await safeReply(interaction, errorEmbed(
        error instanceof Error ? error.message : 'There was an error force voiding the game.',
        'Error',
        true
      ));
    } else {
      await safeReply(interaction, errorEmbed(
        error instanceof Error ? error.message : 'There was an error force voiding the game.',
        'Error',
        false
      ));
    }
  }
}