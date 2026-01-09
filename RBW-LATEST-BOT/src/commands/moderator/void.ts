import { Message, ChatInputCommandInteraction } from 'discord.js';
import Game from '../../models/Game';
import { GameManager } from '../../Matchmaking/GameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

 


export async function voidGame(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let gameId: number;
  let reason: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    gameId = interaction.options.getInteger('gameid', true);
    reason = interaction.options.getString('reason') || `voided by <@${interaction.user.id}>: no reason provided`;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =void <gameId> [reason]', 'Void Command Error'));
      return;
    }
    gameId = parseInt(args[0]);
    reason = args.slice(1).join(' ') || `voided by <@${interaction.author.id}>: no reason provided`;
  }

  try {
    const game = await Game.findOne({ gameId });
    if (!game) {
      await safeReply(interaction, errorEmbed('Game not found!', 'Void Command Error'));
      return;
    }

    if (game.state === 'voided') {
      await safeReply(interaction, errorEmbed('this game already voided', 'Void Command Error'));
      return;
    }

    
    const wsManager = global._wsManager as WebSocketManager;
    if (!wsManager) {
      await safeReply(interaction, errorEmbed('WebSocket manager not available.', 'Void Command Error'));
      return;
    }
    
    const gameManager = new GameManager(interaction.client, wsManager);
    await gameManager.voidGame(gameId, reason);
    
    await safeReply(interaction, successEmbed(`Game ${gameId} has been voided.\nReason: ${reason}\nStats and ELO changes have been reverted. Game channels will be deleted in 30 seconds.`, 'Game Voided'));
  } catch (error) {
    console.error('Error in void command:', error);
    await safeReply(interaction, errorEmbed(error instanceof Error ? error.message : 'There was an error voiding the game.', 'Void Command Error'));
  }
}