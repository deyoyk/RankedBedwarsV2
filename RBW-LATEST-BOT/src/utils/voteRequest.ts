import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ThreadAutoArchiveDuration } from 'discord.js';

export interface VoteData {
  upvote: Set<string>;
  downvote: Set<string>;
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

export async function createDiscussionThread(message: any, threadName: string): Promise<void> {
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
  message: any,
  eligiblePlayers: string[],
  onVote: (userId: string, customId: string) => void,
  timeMs = 15 * 60 * 1000
) {
  const collector = message.createMessageComponentCollector({
    time: timeMs,
    filter: (i: any) => eligiblePlayers.includes(i.user.id)
  });

  collector.on('collect', async (buttonInteraction: any) => {
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
