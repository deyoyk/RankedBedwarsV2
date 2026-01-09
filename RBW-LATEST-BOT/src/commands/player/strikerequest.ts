import { ChatInputCommandInteraction, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ThreadAutoArchiveDuration } from 'discord.js';
import Game from '../../models/Game';
import { StrikeManager } from '../../managers/StrikeManager';
import configuration from '../../config/config';
import { betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

interface StrikeRequestData {
  gameId: string;
  targetId: string;
  reason: string;
  requesterId: string;
}

interface VoteData {
  upvote: Set<string>;
  downvote: Set<string>;
}

export async function strikerequest(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  try {
    const requestData = await parseStrikeRequest(interaction, args);
    if (!requestData) return;

    const validationResult = await validateStrikeRequest(requestData);
    if (!validationResult.isValid) {
      await safeReply(interaction, { content: validationResult.error });
      return;
    }

    await createStrikeRequest(interaction, requestData);
  } catch (error) {
    console.error('Error in strikerequest command:', error);
    await safeReply(interaction, { content: 'An error occurred while processing your strike request.' });
  }
}

async function parseStrikeRequest(interaction: Message | ChatInputCommandInteraction, args?: string[]): Promise<StrikeRequestData | null> {
  const requesterId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;

  if (interaction instanceof ChatInputCommandInteraction) {
    const gameId = interaction.options.getString('gameid', true);
    const target = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason', true);

    return { gameId, targetId: target.id, reason, requesterId };
  } else {
    if (!args || args.length < 3) {
      await safeReply(interaction, 'Usage: =strikerequest <gameid> <target> <reason>');
      return null;
    }

    const [gameId, targetId, ...reasonParts] = args;
    const reason = reasonParts.join(' ');

    if (!reason.trim()) {
      await safeReply(interaction, 'Please provide a valid reason for the strike request.');
      return null;
    }

    return { gameId, targetId, reason, requesterId };
  }
}

async function validateStrikeRequest(data: StrikeRequestData): Promise<{ isValid: boolean; error?: string; game?: any; team?: string[] }> {
  const game = await Game.findOne({ gameId: data.gameId });
  if (!game) {
    return { isValid: false, error: 'Game not found.' };
  }

  if (game.state !== 'active' && game.state !== 'scored') {
    return { isValid: false, error: 'Strike requests can only be made for active or scored games.' };
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

async function createStrikeRequest(interaction: Message | ChatInputCommandInteraction, data: StrikeRequestData) {
  const channel = interaction.guild?.channels.cache.get(configuration.channels.strikerequestsChannel);
  if (!channel?.isTextBased()) {
    await safeReply(interaction, { content: 'Strike request channel not found.' });
    return;
  }

  const game = await Game.findOne({ gameId: data.gameId });
  const team = game?.getTeamOfPlayer(data.requesterId) || [];
  const teamMentions = team.map((id: string) => `<@${id}>`).join(' ');

  const embed = createStrikeRequestEmbed(data, game);
  const components = createVoteButtons();
  
  const message = await channel.send({ 
    content: teamMentions, 
    embeds: [embed], 
    components: [components] 
  });

  await createDiscussionThread(message, data.targetId);
  await setupVoteCollector(message, data, team);
  await safeReply(interaction, { content: 'Strike request created successfully.' });
}

function createStrikeRequestEmbed(data: StrikeRequestData, game: any): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Strike Request')
    .setDescription(`A strike has been requested against <@${data.targetId}>`)
    .addFields(
      { name: 'Reason', value: data.reason, inline: false },
      { name: 'Game ID', value: data.gameId, inline: true },
      { name: 'Requested by', value: `<@${data.requesterId}>`, inline: true },
      { name: 'Game State', value: game?.state || 'Unknown', inline: true }
    )
    .setColor('#ffcc00')
    .setTimestamp()
    .setFooter({ text: `Game ID: ${data.gameId} | Target: ${data.targetId}` });

  return embed;
}

function createVoteButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('strike_upvote')
      .setLabel('Approve Strike')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('strike_downvote')
      .setLabel('Reject Strike')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  );
}

async function createDiscussionThread(message: any, targetId: string) {
  try {
    await message.startThread({ 
      name: `Strike Discussion - ${targetId}`, 
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay 
    });
  } catch (error) {
    console.error('Failed to create discussion thread:', error);
  }
}

async function setupVoteCollector(message: any, data: StrikeRequestData, team: string[]) {
  const votes: VoteData = {
    upvote: new Set(),
    downvote: new Set()
  };

  const collector = message.createMessageComponentCollector({ 
    time: 15 * 60 * 1000,
    filter: (i: any) => team.includes(i.user.id)
  });

  collector.on('collect', async (buttonInteraction: any) => {
    try {
      const userId = buttonInteraction.user.id;
      
      if (votes.upvote.has(userId) || votes.downvote.has(userId)) {
        await buttonInteraction.reply({ 
          content: 'You have already voted on this strike request.', 
          ephemeral: true 
        });
        return;
      }

      if (buttonInteraction.customId === 'strike_upvote') {
        votes.upvote.add(userId);
      } else if (buttonInteraction.customId === 'strike_downvote') {
        votes.downvote.add(userId);
      }

      await buttonInteraction.deferUpdate();
    } catch (error) {
      console.error('Error handling vote:', error);
    }
  });

  collector.on('end', async () => {
    await processVoteResults(message, data, votes, team);
  });
}

async function processVoteResults(message: any, data: StrikeRequestData, votes: VoteData, team: string[]) {
  const teamMentions = team.map((id: string) => `<@${id}>`).join(' ');
  const requiredVotes = Math.max(2, Math.ceil(team.length * 0.6));

  const resultEmbed = new EmbedBuilder()
    .setTitle('Strike Request Results')
    .setColor(votes.upvote.size >= requiredVotes ? '#00ff00' : '#00AAAA')
    .addFields(
      { name: 'Approval Votes', value: votes.upvote.size.toString(), inline: true },
      { name: 'Rejection Votes', value: votes.downvote.size.toString(), inline: true },
      { name: 'Required Votes', value: requiredVotes.toString(), inline: true }
    )
    .setTimestamp();

  try {
    if (votes.upvote.size >= requiredVotes) {
      await StrikeManager.strike(message.guild!, data.targetId, data.requesterId, data.reason);
      resultEmbed.setDescription(`✅ Strike approved and applied to <@${data.targetId}>.`);
    } else {
      resultEmbed.setDescription(`❌ Strike request rejected due to insufficient approval votes.`);
    }

    await message.edit({ 
      content: teamMentions, 
      embeds: [message.embeds[0], resultEmbed], 
      components: [] 
    });
  } catch (error) {
    console.error('Error processing strike request results:', error);
    await message.edit({ 
      content: `${teamMentions} Error processing strike request results.`, 
      components: [] 
    });
  }
}