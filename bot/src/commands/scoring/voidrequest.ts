import { ChatInputCommandInteraction, EmbedBuilder, Message } from 'discord.js';
import Game, { type IGame } from '../../models/Game';
import configuration from '../../config/config';
import { getSharedGameManager } from '../../Matchmaking/sharedGameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { buildResultEmbed, claimVoteRequest, createDiscussionThread, createVoteButtons, releaseVoteRequest, setupVoteCollector, VoteData } from '../../utils/voteRequest';
import { errorEmbed, successEmbed, themedEmbed } from '../../utils/betterembed';

interface VoidRequestData {
  gameId: string;
  reason: string;
  requesterId: string;
}

export async function voidrequest(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  try {
    const requestData = await parseVoidRequest(interaction);
    if (!requestData) return;

    const validationResult = await validateVoidRequest(requestData);
    if (!validationResult.isValid) {
      await safeReply(interaction, errorEmbed(validationResult.error || 'Invalid void request.', 'Void Request Error'));
      return;
    }

    await createVoidRequest(interaction, requestData, validationResult.game);
  } catch (error) {
    console.error('Error in voidrequest command:', error);
    await safeReply(interaction, errorEmbed('An error occurred while processing your void request.', 'Void Request Error'));
  }
}

async function parseVoidRequest(interaction: ChatInputCommandInteraction): Promise<VoidRequestData | null> {
  const requesterId = interaction.user.id;

  
    const gameId = interaction.options.getString('game_id', true);
    const reason = interaction.options.getString('reason', true);

    return { gameId, reason, requesterId };
  
}

async function validateVoidRequest(data: VoidRequestData): Promise<{ isValid: true; game: IGame } | { isValid: false; error: string; game?: undefined }> {
  const game = await Game.findOne({ gameId: data.gameId }).select('state team1 team2 map');
  if (!game) {
    return { isValid: false, error: 'Game not found.' };
  }

  if (game.state === 'voided') {
    return { isValid: false, error: 'Game is already voided.' };
  }

  if (game.state === 'scored') {
    return { isValid: false, error: 'Cannot void a game that has already been scored.' };
  }

  const allPlayers = [...game.team1, ...game.team2];
  if (!allPlayers.includes(data.requesterId)) {
    return { isValid: false, error: 'You are not a participant in this game.' };
  }

  return { isValid: true, game };
}

async function createVoidRequest(interaction: ChatInputCommandInteraction, data: VoidRequestData, game: IGame) {
  const channel = interaction.guild?.channels.cache.get(configuration.channels.voidrequestsChannel);
  if (!channel?.isTextBased()) {
    await safeReply(interaction, errorEmbed('Void request channel not found.', 'Void Request Error'));
    return;
  }

  const allPlayers = [...game.team1, ...game.team2];
  const teamMentions = allPlayers.map((id: string) => `<@${id}>`).join(' ');

  const claimed = await claimVoteRequest(data.gameId, 'void', data.requesterId);
  if (!claimed) {
    await safeReply(interaction, errorEmbed('There is already an open vote request for this game.', 'Void Request Error'));
    return;
  }

  const embed = createVoidRequestEmbed(data, game);
  const components = createVoteButtons('Approve Void', 'Reject Void', 'void');

  const message = await channel.send({
    content: teamMentions,
    embeds: [embed],
    components: [components]
  });

  await createDiscussionThread(message, `Void Discussion - Game ${data.gameId}`);

  const votes: VoteData = { upvote: new Set(), downvote: new Set() };
  const collector = setupVoteCollector(message, allPlayers, (userId, customId) => {
    if (votes.upvote.has(userId) || votes.downvote.has(userId)) return;
    if (customId === 'void_upvote') votes.upvote.add(userId);
    else if (customId === 'void_downvote') votes.downvote.add(userId);
  });

  collector.on('end', async () => {
    await processVoteResults(message, data, votes, allPlayers);
  });

  await safeReply(interaction, successEmbed('Void request created successfully.', 'Void Request Created'));
}

function createVoidRequestEmbed(data: VoidRequestData, game: IGame): EmbedBuilder {
  return themedEmbed()
    .setTitle('Void Request')
    .setDescription(`A void has been requested for Game ID: ${data.gameId}`)
    .addFields(
      { name: 'Reason', value: data.reason, inline: false },
      { name: 'Game ID', value: data.gameId, inline: true },
      { name: 'Requested by', value: `<@${data.requesterId}>`, inline: true },
      { name: 'Game State', value: game?.state || 'Unknown', inline: true },
      { name: 'Map', value: game?.map || 'Unknown', inline: true },
      { name: 'Team 1', value: game?.team1?.map((id: string) => `<@${id}>`).join(', ') || 'None', inline: false },
      { name: 'Team 2', value: game?.team2?.map((id: string) => `<@${id}>`).join(', ') || 'None', inline: false }
    )
    .setColor('#ff6b6b')
    .setTimestamp()
    .setFooter({ text: `Game ID: ${data.gameId}` });
}

async function processVoteResults(message: Message, data: VoidRequestData, votes: VoteData, allPlayers: string[]) {
  const teamMentions = allPlayers.map((id: string) => `<@${id}>`).join(' ');
  const requiredVotes = Math.max(2, Math.ceil(allPlayers.length * 0.6));
  const approved = votes.upvote.size >= requiredVotes;

  const resultEmbed = buildResultEmbed('Void Request Results', votes, requiredVotes, approved);

  try {
    if (approved) {
      const freshGame = await Game.findOne({ gameId: data.gameId }).select('state').lean();
      if (!freshGame) {
        resultEmbed.setDescription(`❌ Void request failed: game not found.`);
      } else if (freshGame.state === 'scored' || freshGame.state === 'voided' || freshGame.state === 'scoring') {
        resultEmbed.setDescription(`❌ Void request not applied: game state changed to ${freshGame.state}.`);
      } else {
        const resolvedWs = (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
        if (!resolvedWs) {
          resultEmbed.setDescription(`❌ Void request failed due to WebSocket manager not being available.`);
        } else {
          const gameManager = getSharedGameManager(message.client, resolvedWs!);
          await gameManager.voidGame(parseInt(data.gameId), data.reason);
          resultEmbed.setDescription(`✅ Void approved and applied to Game ID: ${data.gameId}.`);
        }
      }
    } else {
      resultEmbed.setDescription(`❌ Void request rejected due to insufficient approval votes.`);
    }

    await message.edit({
      content: teamMentions,
      embeds: [message.embeds[0], resultEmbed],
      components: []
    });
    await releaseVoteRequest(data.gameId, 'void');
  } catch (error) {
    console.error('Error processing void request results:', error);
    await releaseVoteRequest(data.gameId, 'void');
    await message.edit({
      content: teamMentions,
      embeds: [errorEmbed('Error processing void request results.', 'Void Request Error').builder],
      components: []
    });
  }
}
