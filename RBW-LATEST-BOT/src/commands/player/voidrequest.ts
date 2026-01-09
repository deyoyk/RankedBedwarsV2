import { ChatInputCommandInteraction, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ThreadAutoArchiveDuration } from 'discord.js';
import Game from '../../models/Game';
import configuration from '../../config/config';
import { GameManager } from '../../Matchmaking/GameManager';
import { WebSocketManager } from '../../websocket/WebSocketManager';
import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

interface VoidRequestData {
  gameId: string;
  reason: string;
  requesterId: string;
}

interface VoteData {
  upvote: Set<string>;
  downvote: Set<string>;
}

export async function voidrequest(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  try {
    const requestData = await parseVoidRequest(interaction, args);
    if (!requestData) return;

    const validationResult = await validateVoidRequest(requestData);
    if (!validationResult.isValid) {
      await safeReply(interaction, { content: validationResult.error });
      return;
    }

    await createVoidRequest(interaction, requestData, validationResult.game);
  } catch (error) {
    console.error('Error in voidrequest command:', error);
    await safeReply(interaction, { content: 'An error occurred while processing your void request.' });
  }
}

async function parseVoidRequest(interaction: Message | ChatInputCommandInteraction, args?: string[]): Promise<VoidRequestData | null> {
  const requesterId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;

  if (interaction instanceof ChatInputCommandInteraction) {
    const gameId = interaction.options.getString('gameid', true);
    const reason = interaction.options.getString('reason', true);

    return { gameId, reason, requesterId };
  } else {
    if (!args || args.length < 2) {
      await safeReply(interaction, 'Usage: =voidrequest <gameid> <reason>');
      return null;
    }

    const [gameId, ...reasonParts] = args;
    const reason = reasonParts.join(' ');

    if (!reason.trim()) {
      await safeReply(interaction, 'Please provide a valid reason for the void request.');
      return null;
    }

    return { gameId, reason, requesterId };
  }
}

async function validateVoidRequest(data: VoidRequestData): Promise<{ isValid: boolean; error?: string; game?: any }> {
  const game = await Game.findOne({ gameId: data.gameId });
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

async function createVoidRequest(interaction: Message | ChatInputCommandInteraction, data: VoidRequestData, game: any) {
  const channel = interaction.guild?.channels.cache.get(configuration.channels.voidrequestsChannel);
  if (!channel?.isTextBased()) {
    await safeReply(interaction, { content: 'Void request channel not found.' });
    return;
  }

  const allPlayers = [...game.team1, ...game.team2];
  const teamMentions = allPlayers.map((id: string) => `<@${id}>`).join(' ');

  const embed = createVoidRequestEmbed(data, game);
  const components = createVoteButtons();
  
  const message = await channel.send({ 
    content: teamMentions, 
    embeds: [embed], 
    components: [components] 
  });

  await createDiscussionThread(message, data.gameId);
  await setupVoteCollector(message, data, allPlayers, game);
  await safeReply(interaction, { content: 'Void request created successfully.' });
}

function createVoidRequestEmbed(data: VoidRequestData, game: any): EmbedBuilder {
  const embed = new EmbedBuilder()
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

  return embed;
}

function createVoteButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('void_upvote')
      .setLabel('Approve Void')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('void_downvote')
      .setLabel('Reject Void')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  );
}

async function createDiscussionThread(message: any, gameId: string) {
  try {
    await message.startThread({ 
      name: `Void Discussion - Game ${gameId}`, 
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay 
    });
  } catch (error) {
    console.error('Failed to create discussion thread:', error);
  }
}

async function setupVoteCollector(message: any, data: VoidRequestData, allPlayers: string[], game: any) {
  const votes: VoteData = {
    upvote: new Set(),
    downvote: new Set()
  };

  const collector = message.createMessageComponentCollector({ 
    time: 15 * 60 * 1000,
    filter: (i: any) => allPlayers.includes(i.user.id)
  });

  collector.on('collect', async (buttonInteraction: any) => {
    try {
      const userId = buttonInteraction.user.id;
      
      if (votes.upvote.has(userId) || votes.downvote.has(userId)) {
        await buttonInteraction.reply({ 
          content: 'You have already voted on this void request.', 
          ephemeral: true 
        });
        return;
      }

      if (buttonInteraction.customId === 'void_upvote') {
        votes.upvote.add(userId);
      } else if (buttonInteraction.customId === 'void_downvote') {
        votes.downvote.add(userId);
      }

      await buttonInteraction.deferUpdate();
    } catch (error) {
      console.error('Error handling vote:', error);
    }
  });

  collector.on('end', async () => {
    await processVoteResults(message, data, votes, allPlayers, game);
  });
}

async function processVoteResults(message: any, data: VoidRequestData, votes: VoteData, allPlayers: string[], game: any) {
  const teamMentions = allPlayers.map((id: string) => `<@${id}>`).join(' ');
  const requiredVotes = Math.max(2, Math.ceil(allPlayers.length * 0.6));

  const resultEmbed = new EmbedBuilder()
    .setTitle('Void Request Results')
    .setColor(votes.upvote.size >= requiredVotes ? '#00ff00' : '#00AAAA')
    .addFields(
      { name: 'Approval Votes', value: votes.upvote.size.toString(), inline: true },
      { name: 'Rejection Votes', value: votes.downvote.size.toString(), inline: true },
      { name: 'Required Votes', value: requiredVotes.toString(), inline: true }
    )
    .setTimestamp();

  try {
    if (votes.upvote.size >= requiredVotes) {
      const wsManager = global._wsManager as WebSocketManager;
      if (!wsManager) {
        resultEmbed.setDescription(`❌ Void request failed due to WebSocket manager not being available.`);
      } else {
        const gameManager = new GameManager(message.client, wsManager);
        await gameManager.voidGame(parseInt(data.gameId), data.reason);
        resultEmbed.setDescription(`✅ Void approved and applied to Game ID: ${data.gameId}.`);
      }
    } else {
      resultEmbed.setDescription(`❌ Void request rejected due to insufficient approval votes.`);
    }

    await message.edit({ 
      content: teamMentions, 
      embeds: [message.embeds[0], resultEmbed], 
      components: [] 
    });
  } catch (error) {
    console.error('Error processing void request results:', error);
    await message.edit({ 
      content: `${teamMentions} Error processing void request results.`, 
      components: [] 
    });
  }
}