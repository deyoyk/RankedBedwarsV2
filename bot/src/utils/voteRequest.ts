import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Message, MessageComponentInteraction, ThreadAutoArchiveDuration } from 'discord.js';
import VoteRequest from '../models/VoteRequest';

export interface VoteData {
  upvote: Set<string>;
  downvote: Set<string>;
}

export async function claimVoteRequest(gameId: string, scope: string, requesterId: string, messageId?: string): Promise<boolean> {
  try {
    await VoteRequest.create({
      key: `${gameId}:${scope}`,
      gameId,
      scope,
      requesterId,
      messageId,
      expireAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    return true;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 11000) return false;
    throw error;
  }
}

export async function releaseVoteRequest(gameId: string, scope: string): Promise<void> {
  try {
    await VoteRequest.deleteOne({ key: `${gameId}:${scope}` });
  } catch (error) {
    console.error('Error releasing vote request:', error);
  }
}

export function createVoteButtons(upLabel: string, downLabel: string, prefix: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_upvote`)
      .setLabel(upLabel)
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`${prefix}_downvote`)
      .setLabel(downLabel)
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  );
}

export async function createDiscussionThread(message: Message, threadName: string): Promise<void> {
  try {
    await message.startThread({
      name: threadName,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay
    });
  } catch (error) {
    console.error('Failed to create discussion thread:', error);
  }
}

export function setupVoteCollector(
  message: Message,
  eligiblePlayers: string[],
  onVote: (userId: string, customId: string) => void,
  timeMs = 15 * 60 * 1000
) {
  const eligible = new Set(eligiblePlayers);
  const collector = message.createMessageComponentCollector({
    time: timeMs,
    filter: (i: MessageComponentInteraction) => eligible.has(i.user.id)
  });

  collector.on('collect', async (buttonInteraction: MessageComponentInteraction) => {
    try {
      onVote(buttonInteraction.user.id, buttonInteraction.customId);
      await buttonInteraction.deferUpdate();
    } catch (error) {
      console.error('Error handling vote:', error);
    }
  });

  return collector;
}

export function buildResultEmbed(
  title: string,
  votes: VoteData,
  requiredVotes: number,
  approved: boolean
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(approved ? '#00ff00' : '#00AAAA')
    .addFields(
      { name: 'Approval Votes', value: votes.upvote.size.toString(), inline: true },
      { name: 'Rejection Votes', value: votes.downvote.size.toString(), inline: true },
      { name: 'Required Votes', value: requiredVotes.toString(), inline: true }
    )
    .setTimestamp();
}
