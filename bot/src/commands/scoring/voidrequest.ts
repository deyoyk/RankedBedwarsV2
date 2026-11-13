import { ChatInputCommandInteraction, EmbedBuilder, Message, MessageFlags, ModalSubmitInteraction } from 'discord.js';
import Game, { type IGame } from '../../models/Game';
import configuration from '../../config/config';
import { getSharedGameManager } from '../../Matchmaking/sharedGameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { buildResultEmbed, claimVoteRequest, createDiscussionThread, createVoteButtons, releaseVoteRequest, setupVoteCollector, VoteData } from '../../utils/voteRequest';
import { embedsFor } from '../../utils/betterembed';
import { formatMapName } from '../../utils/mapName';

const { errorEmbed, successEmbed, themedEmbed } = embedsFor('Scoring');

interface VoidRequestData {
  gameId: string;
  reason: string;
  requesterId: string;
}

type VoidRequestSource = ChatInputCommandInteraction | ModalSubmitInteraction;

async function reply(interaction: VoidRequestSource, payload: { embeds: EmbedBuilder[] }) {
  if (interaction instanceof ModalSubmitInteraction) {
    if (interaction.replied || interaction.deferred) await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  await safeReply(interaction, payload);
}

export async function voidrequest(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  try {
    const requestData = await parseVoidRequest(interaction);
    if (!requestData) return;
    await submitVoidRequest(interaction, requestData);
  } catch (error) {
    console.error('Error in voidrequest command:', error);
    await safeReply(interaction, errorEmbed('An error occurred while processing your void request.', 'Void Request Error'));
  }
}

/** Validates and posts a void vote. Used by /voidrequest and by the Request void button on /gameinfo. */
export async function submitVoidRequest(interaction: VoidRequestSource, requestData: VoidRequestData) {
  const validationResult = await validateVoidRequest(requestData);
  if (!validationResult.isValid) {
    await reply(interaction, { embeds: [errorEmbed(validationResult.error || 'Invalid void request.').builder] });
    return;
  }
  await createVoidRequest(interaction, requestData, validationResult.game);
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

async function createVoidRequest(interaction: VoidRequestSource, data: VoidRequestData, game: IGame) {
  const channel = interaction.guild?.channels.cache.get(configuration.channels.voidrequestsChannel);
  if (!channel?.isTextBased()) {
    await reply(interaction, { embeds: [errorEmbed('Void request channel not found.').builder] });
    return;
  }

  const allPlayers = [...game.team1, ...game.team2];
  const teamMentions = allPlayers.map((id: string) => `<@${id}>`).join(' ');

  const claimed = await claimVoteRequest(data.gameId, 'void', data.requesterId);
  if (!claimed) {
    await reply(interaction, { embeds: [errorEmbed('There is already an open vote request for this game.').builder] });
    return;
  }

  const embed = createVoidRequestEmbed(data, game);
  const components = createVoteButtons('Approve', 'Reject', 'void');

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

  await reply(interaction, { embeds: [successEmbed(`Void request for game \`#${data.gameId}\` posted in <#${channel.id}>.`).builder] });
}

function createVoidRequestEmbed(data: VoidRequestData, game: IGame): EmbedBuilder {
  const players = [...(game?.team1 || []), ...(game?.team2 || [])];
  const needed = Math.max(2, Math.ceil(players.length * 0.6));
  const mentions = (ids: string[] | undefined) => ids?.map((id: string) => `<@${id}>`).join(' ') || 'None';
  return themedEmbed('warning')
    .setDescription(`<@${data.requesterId}> has requested a void for game \`#${data.gameId}\`.\n> **Reason:** ${data.reason}`)
    .addFields(
      { name: 'Map', value: `\`${game?.map ? formatMapName(game.map) : 'Unknown'}\``, inline: true },
      { name: 'Status', value: `\`${game?.state || 'unknown'}\``, inline: true },
      { name: 'Needed', value: `\`${needed} votes\``, inline: true },
      { name: 'Team 1 · Red', value: mentions(game?.team1), inline: true },
      { name: 'Team 2 · Green', value: mentions(game?.team2), inline: true }
    )
    .setTimestamp();
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
        resultEmbed.setColor('error').setDescription('Void request failed: game not found.');
      } else if (freshGame.state === 'scored' || freshGame.state === 'voided' || freshGame.state === 'scoring') {
        resultEmbed.setColor('error').setDescription(`Void request not applied: game state changed to ${freshGame.state}.`);
      } else {
        const resolvedWs = (global as unknown as { _wsManager?: WebSocketManager })._wsManager;
        if (!resolvedWs) {
          resultEmbed.setColor('error').setDescription('Void request failed because the WebSocket manager is not available.');
        } else {
          const gameManager = getSharedGameManager(message.client, resolvedWs!);
          await gameManager.voidGame(parseInt(data.gameId), data.reason);
          resultEmbed.setColor('success').setDescription(`Void approved and applied to Game ID ${data.gameId}.`);
        }
      }
    } else {
      resultEmbed.setColor('warning').setDescription('Void request rejected due to insufficient approval votes.');
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
