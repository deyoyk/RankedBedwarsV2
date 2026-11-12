import { ChatInputCommandInteraction } from 'discord.js';
import { getSharedGameManager } from '../../Matchmaking/sharedGameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import Game from '../../models/Game';
import User from '../../models/User';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { bedBreakerLimitMessage, getMaxBedBreakersPerGame, getMaxMvpsPerGame, mvpLimitMessage, uniquePlayers } from '../../utils/scoringLimits';

const { errorEmbed, successEmbed } = embedsFor('Scoring');

interface ScoreParams {
  gameId: number;
  winningTeam: 1 | 2;
  mvps: string[];
  bedbreaks: string[];
  reason: string;
}

function parseScoreArgs(interaction: ChatInputCommandInteraction): ScoreParams | null {
  const gameId = interaction.options.getInteger('game_id');
  const winningTeam = interaction.options.getInteger('winning_team') ?? interaction.options.getInteger('winningteam');
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
}

export async function score(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const params = parseScoreArgs(interaction);
  if (!params) {
    await safeReply(interaction, errorEmbed(`Usage: /score <gameId> <winningTeam:1|2> [mvps_comma] [bedbreaks_comma] [reason]`, 'Score Command Error'));
    return;
  }

  const { gameId, winningTeam, reason } = params;
  const mvps = uniquePlayers(params.mvps);
  const bedbreaks = uniquePlayers(params.bedbreaks);
  const maxMvps = getMaxMvpsPerGame();
  const maxBedBreakers = getMaxBedBreakersPerGame();
  if (mvps.length > maxMvps) {
    await safeReply(interaction, errorEmbed(mvpLimitMessage(maxMvps), 'Score Command Error'));
    return;
  }
  if (bedbreaks.length > maxBedBreakers) {
    await safeReply(interaction, errorEmbed(bedBreakerLimitMessage(maxBedBreakers), 'Score Command Error'));
    return;
  }

  const isDiscordIdOrMention = (val: string) => /^\d{17,20}$/.test(val) || /^<@!?\d{17,20}>$/.test(val);
  if (mvps.find(isDiscordIdOrMention) || bedbreaks.find(isDiscordIdOrMention)) {
    await safeReply(interaction, errorEmbed('Please enter player IGNs (not Discord IDs or mentions) for MVPs and Bedbreakers.', 'Score Command Error'));
    return;
  }

  try {
    const game = await Game.findOne({ gameId }).select('state').lean();
    if (!game) {
      await safeReply(interaction, errorEmbed('Game not found!', 'Score Command Error'));
      return;
    }
    if (game.state === 'scored') {
      await safeReply(interaction, errorEmbed('This game has already been scored and cannot be scored again.', 'Score Command Error'));
      return;
    }

    const users = await User.find({ ign: { $in: [...mvps, ...bedbreaks] } }).select('ign discordId').lean();
    const ignToId: Record<string, string> = {};
    for (const user of users) {
      ignToId[user.ign] = user.discordId;
    }

    const resolvedWs = _wsManager ?? (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
    if (!resolvedWs) {
      await safeReply(interaction, errorEmbed('WebSocket manager not available.', 'Score Command Error'));
      return;
    }

    const gameManager = getSharedGameManager(interaction.client, resolvedWs!);
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