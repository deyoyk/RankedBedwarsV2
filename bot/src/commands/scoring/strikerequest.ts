import { ChatInputCommandInteraction, EmbedBuilder, Message } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import Game, { IGame } from '../../models/Game';
import { StrikeManager } from '../../managers/StrikeManager';
import configuration from '../../config/config';
import { safeReply } from '../../utils/safeReply';
import { buildResultEmbed, claimVoteRequest, createDiscussionThread, createVoteButtons, releaseVoteRequest, setupVoteCollector, VoteData } from '../../utils/voteRequest';
import { errorEmbed, successEmbed, themedEmbed } from '../../utils/betterembed';

interface StrikeRequestData {
  gameId: string;
  targetId: string;
  reason: string;
  requesterId: string;
}

export async function strikerequest(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  try {
    const requestData = await parseStrikeRequest(interaction);
    if (!requestData) return;

    const validationResult = await validateStrikeRequest(requestData);
    if (!validationResult.isValid) {
      await safeReply(interaction, errorEmbed(validationResult.error || 'Invalid strike request.', 'Strike Request Error'));
      return;
    }

    await createStrikeRequest(interaction, requestData);
  } catch (error) {
    console.error('Error in strikerequest command:', error);
    await safeReply(interaction, errorEmbed('An error occurred while processing your strike request.', 'Strike Request Error'));
  }
}

async function parseStrikeRequest(interaction: ChatInputCommandInteraction): Promise<StrikeRequestData | null> {
  const requesterId = interaction.user.id;

  
    const gameId = interaction.options.getString('game_id', true);
    const target = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason', true);

    return { gameId, targetId: target.id, reason, requesterId };
  
}

async function validateStrikeRequest(data: StrikeRequestData): Promise<{ isValid: boolean; error?: string; game?: IGame; team?: string[] }> {
  const game = await Game.findOne({ gameId: data.gameId }).select('state team1 team2');
  if (!game) {
    return { isValid: false, error: 'Game not found.' };
  }

  if (game.state !== 'pending' && game.state !== 'active' && game.state !== 'scored') {
    return { isValid: false, error: 'Strike requests can only be made for ongoing or scored games.' };
  }

  const team = game.getTeamOfPlayer(data.requesterId);
  if (!team) {
    return { isValid: false, error: 'You are not a participant in this game.' };
  }

  if (!team.includes(data.targetId)) {
    return { isValid: false, error: 'You and the target must be on the same team.' };
  }

  if (data.requesterId === data.targetId) {
    return { isValid: false, error: 'You cannot request a strike against yourself.' };
  }

  return { isValid: true, game, team };
}

async function createStrikeRequest(interaction: ChatInputCommandInteraction, data: StrikeRequestData) {
  const channel = interaction.guild?.channels.cache.get(configuration.channels.strikerequestsChannel);
  if (!channel?.isTextBased()) {
    await safeReply(interaction, errorEmbed('Strike request channel not found.', 'Strike Request Error'));
    return;
  }

  const game = await Game.findOne({ gameId: data.gameId }).select('state team1 team2');
  const team = game?.getTeamOfPlayer(data.requesterId) || [];
  const teamMentions = team.map((id: string) => `<@${id}>`).join(' ');

  const claimed = await claimVoteRequest(data.gameId, `strike:${data.targetId}`, data.requesterId);
  if (!claimed) {
    await safeReply(interaction, errorEmbed('There is already an open vote request for this target.', 'Strike Request Error'));
    return;
  }

  const embed = createStrikeRequestEmbed(data, game);
  const components = createVoteButtons('Approve Strike', 'Reject Strike', 'strike');

  const message = await channel.send({
    content: teamMentions,
    embeds: [embed],
    components: [components]
  });

  await createDiscussionThread(message, `Strike Discussion - ${data.targetId}`);

  const votes: VoteData = { upvote: new Set(), downvote: new Set() };
  const collector = setupVoteCollector(message, team, (userId, customId) => {
    if (votes.upvote.has(userId) || votes.downvote.has(userId)) return;
    if (customId === 'strike_upvote') votes.upvote.add(userId);
    else if (customId === 'strike_downvote') votes.downvote.add(userId);
  });

  collector.on('end', async () => {
    await processVoteResults(message, data, votes, team);
  });

  await safeReply(interaction, successEmbed('Strike request created successfully.', 'Strike Request Created'));
}

function createStrikeRequestEmbed(data: StrikeRequestData, game: IGame | null): EmbedBuilder {
  return themedEmbed('warning')
    .setTitle('Strike Request')
    .setDescription(`A strike has been requested against <@${data.targetId}>.`)
    .addFields(
      { name: 'Reason', value: data.reason, inline: false },
      { name: 'Game ID', value: data.gameId, inline: true },
      { name: 'Requested by', value: `<@${data.requesterId}>`, inline: true },
      { name: 'Game State', value: game?.state || 'Unknown', inline: true }
    );
}

async function processVoteResults(message: Message, data: StrikeRequestData, votes: VoteData, team: string[]) {
  const teamMentions = team.map((id: string) => `<@${id}>`).join(' ');
  const requiredVotes = Math.max(2, Math.ceil(team.length * 0.6));
  const approved = votes.upvote.size >= requiredVotes;

  const resultEmbed = buildResultEmbed('Strike Request Results', votes, requiredVotes, approved);

  try {
    if (approved) {
      const freshGame = await Game.findOne({ gameId: data.gameId }).select('state').lean();
      if (!freshGame) {
        resultEmbed.setColor('error').setDescription('Strike request failed: game not found.');
      } else if (freshGame.state === 'scored' || freshGame.state === 'voided' || freshGame.state === 'scoring') {
        resultEmbed.setColor('error').setDescription(`Strike request not applied: game state changed to ${freshGame.state}.`);
      } else {
        await StrikeManager.strike(message.guild!, data.targetId, data.requesterId, data.reason);
        resultEmbed.setColor('success').setDescription(`Strike approved and applied to <@${data.targetId}>.`);
      }
    } else {
      resultEmbed.setColor('warning').setDescription('Strike request rejected due to insufficient approval votes.');
    }

    await message.edit({
      content: teamMentions,
      embeds: [message.embeds[0], resultEmbed],
      components: []
    });
    await releaseVoteRequest(data.gameId, `strike:${data.targetId}`);
  } catch (error) {
    console.error('Error processing strike request results:', error);
    await releaseVoteRequest(data.gameId, `strike:${data.targetId}`);
    await message.edit({
      content: teamMentions,
      embeds: [errorEmbed('Error processing strike request results.', 'Strike Request Error').builder],
      components: []
    });
  }
}
