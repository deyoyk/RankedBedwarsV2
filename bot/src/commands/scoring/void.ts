import { ChatInputCommandInteraction } from 'discord.js';
import Game from '../../models/Game';
import { getSharedGameManager } from '../../Matchmaking/sharedGameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

const { errorEmbed, successEmbed } = embedsFor('Scoring');

export async function voidGame(interaction: ChatInputCommandInteraction, wsManager?: WebSocketManager) {
  const gameId = interaction.options.getInteger('game_id', true);
  const reason = interaction.options.getString('reason') || `voided by <@${interaction.user.id}>: no reason provided`;


  try {
    const game = await Game.findOne({ gameId }).select('state').lean();
    if (!game) {
      await safeReply(interaction, errorEmbed('Game not found!', 'Void Command Error'));
      return;
    }

    if (game.state === 'voided') {
      await safeReply(interaction, errorEmbed('this game already voided', 'Void Command Error'));
      return;
    }

    
    const resolvedWs = wsManager ?? (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
    if (!resolvedWs) {
      await safeReply(interaction, errorEmbed('WebSocket manager not available.', 'Void Command Error'));
      return;
    }
    
    const gameManager = getSharedGameManager(interaction.client, resolvedWs!);
    await gameManager.voidGame(gameId, reason);
    
    await safeReply(interaction, successEmbed(`Game ${gameId} has been voided.\nReason: ${reason}\nStats and ELO changes have been reverted. Game threads will be archived in 30 seconds.`, 'Game Voided'));
  } catch (error) {
    console.error('Error in void command:', error);
    await safeReply(interaction, errorEmbed('There was an error voiding the game.', 'Void Command Error'));
  }
}