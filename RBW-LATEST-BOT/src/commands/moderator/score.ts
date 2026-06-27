import { Message, ChatInputCommandInteraction } from 'discord.js';
import { GameManager } from '../../Matchmaking/GameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import Game from '../../models/Game';
import User from '../../models/User';
import { GameResult } from '../../types/GameTypes';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

interface ScoreParams {
  gameId: number;
  winningTeam: 1 | 2;
  mvps: string[];
  bedbreaks: string[];
  reason: string;
}

function parseScoreArgs(interaction: Message | ChatInputCommandInteraction, args?: string[]): ScoreParams | null {
  if (interaction instanceof ChatInputCommandInteraction) {
    const gameId = interaction.options.getInteger('gameid');
    const winningTeam = interaction.options.getInteger('winningteam') || interaction.options.getInteger('winning_team') || interaction.options.getInteger('team');
    if (!gameId) return null;
    if (!winningTeam || (winningTeam !== 1 && winningTeam !== 2)) return null;
    const mvpsStr = interaction.options.getString('mvps') || '';
    const bedbreaksStr = interaction.options.getString('bedbreaks') || '';
    return {
      gameId,
      winningTeam: winningTeam as 1 | 2,
      mvps: mvpsStr ? mvpsStr.split(',').map(id => id.trim()).filter(Boolean) : [],
      bedbreaks: bedbreaksStr ? bedbreaksStr.split(',').map(id => id.trim()).filter(Boolean) : [],
      reason: interaction.options.getString('reason') || `scored by <@${interaction.user.id}>: no reason provided`
    };
  } else {
    if (!args || args.length < 3) return null;
    const gameId = parseInt(args[0]);
    const winningTeam = parseInt(args[1]) as 1 | 2;
    return {
      gameId,
      winningTeam,
      mvps: args[2] ? args[2].split(',').map(id => id.trim()).filter(Boolean) : [],
      bedbreaks: args[3] ? args[3].split(',').map(id => id.trim()).filter(Boolean) : [],
      reason: args[4] ? args.slice(4).join(' ') : `scored by <@${interaction.author.id}>: no reason provided`
    };
  }
}

export async function score(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  const params = parseScoreArgs(interaction, args);
  if (!params) {
    await safeReply(interaction, errorEmbed('Usage: =score <gameId> <winningTeam:1|2> [mvps_comma] [bedbreaks_comma] [reason]', 'Score Command Error'));
    return;
  }

  const { gameId, winningTeam, mvps, bedbreaks, reason } = params;

  const isDiscordIdOrMention = (val: string) => /^\d{17,20}$/.test(val) || /^<@!?\d{17,20}>$/.test(val);
  if (mvps.find(isDiscordIdOrMention) || bedbreaks.find(isDiscordIdOrMention)) {
    await safeReply(interaction, errorEmbed('Please enter player IGNs (not Discord IDs or mentions) for MVPs and Bedbreakers.', 'Score Command Error'));
    return;
  }

  try {
    const game = await Game.findOne({ gameId });
    if (!game) {
      await safeReply(interaction, errorEmbed('Game not found!', 'Score Command Error'));
      return;
    }
    if (game.state === 'scored') {
      await safeReply(interaction, errorEmbed('This game has already been scored and cannot be scored again.', 'Score Command Error'));
      return;
    }

    const users = await User.find({ ign: { $in: [...mvps, ...bedbreaks] } });
    const ignToId: Record<string, string> = {};
    for (const user of users) {
      ignToId[user.ign] = user.discordId;
    }

    const wsManager = global._wsManager as WebSocketManager;
    if (!wsManager) {
      await safeReply(interaction, errorEmbed('WebSocket manager not available.', 'Score Command Error'));
      return;
    }

    const gameManager = new GameManager(interaction.client, wsManager);
    await gameManager.scoreGame({ gameId, winningTeam, mvps, bedbreaks, reason });

    await safeReply(interaction, successEmbed(
      `Game ${gameId} scored!\nReason: ${reason}\nWinning Team: Team ${winningTeam}` +
      (mvps.length ? `\nMVPs: ${mvps.map(ign => `<@${ignToId[ign]||ign}>`).join(', ')}` : '') +
      (bedbreaks.length ? `\nBedbreaks: ${bedbreaks.map(ign => `<@${ignToId[ign]||ign}>`).join(', ')}` : ''),
      'Game Scored'
    ));
  } catch (error) {
    console.error('Error in score command:', error);
    await safeReply(interaction, errorEmbed('There was an error recording the game score.', 'Score Command Error'));
  }
}