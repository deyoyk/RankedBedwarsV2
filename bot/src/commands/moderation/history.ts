import { Message, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import User from '../../models/User';

interface HistoryRecordView {
  reason: string;
  date: Date;
  duration?: number | null;
  moderator: string;
}

interface HistoryUserView {
  discordId: string;
  bans: HistoryRecordView[];
  mutes: HistoryRecordView[];
  strikes: HistoryRecordView[];
}


import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

export async function history(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let discordId: string;
  let historyType: string;
  let preloadedUser: HistoryUserView | null = null;

  let userInput: string | null = null;

  if (interaction instanceof ChatInputCommandInteraction) {
    discordId = interaction.options.getString('user_id', true);
    historyType = interaction.options.getString('type', true).toLowerCase();
  } else {
    if (args && args.length >= 2) {
      userInput = args[0];
      discordId = userInput.replace(/[<@!>]/g, '');
      historyType = args[1].toLowerCase();
    } else {
      const embed = new EmbedBuilder()
        .setColor('#00AAAA')
        .setTitle('History Command Error')
        .setDescription('Usage: =history <userId|mention|IGN> <type>')
        .setTimestamp();
      await safeReply(interaction, { embeds: [embed] });
      return;
    }
  }

  if (!['ban', 'mute', 'strike'].includes(historyType)) {
    await safeReply(interaction, errorEmbed('Valid types are: `ban`, `mute`, `strike`.', 'Invalid History Type'));
    return;
  }
  const recordsField = historyType === 'ban' ? 'bans' : historyType === 'mute' ? 'mutes' : 'strikes';

  if (userInput !== null) {
    const isIdLike = /^<@!?\d+>$/.test(userInput) || /^\d+$/.test(userInput);
    const user = isIdLike
      ? await User.findOne({ discordId }).select(`discordId ${recordsField}`).lean()
      : await User.findOne({ ign: userInput }).collation({ locale: 'en', strength: 2 }).select(`discordId ${recordsField}`).lean();

    if (!user) {
      const embed = new EmbedBuilder()
        .setColor('#00AAAA')
        .setTitle('History Not Found')
        .setDescription('No user found with the specified ID, mention, or IGN.')
        .setTimestamp();
      await safeReply(interaction, { embeds: [embed] });
      return;
    }

    discordId = user.discordId;
    preloadedUser = user;
  }

  try {
    const user = preloadedUser ?? await User.findOne({ discordId }).select(`discordId ${recordsField}`).lean();
    if (!user) {
      await safeReply(interaction, errorEmbed('No user found with the specified ID.', 'History Not Found'));
      return;
    }

    const historyItems = user[recordsField];

    if (historyItems.length === 0) {
      await safeReply(interaction, successEmbed(`No ${historyType}s found for <@${discordId}>.`, 'No History Found'));
      return;
    }

    const itemsPerPage = 5;
    let currentPage = 0;

    const generateEmbed = (page: number) => {
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      const pageItems = historyItems.slice(start, end);

      const description = pageItems
        .map((item, index) => {
          const duration = 'duration' in item ? item.duration : 'N/A';
          return `\`\`\`
${index + 1 + start}. Reason: ${item.reason}
Date: ${item.date.toDateString()}
Duration: ${duration}
Moderator: ${item.moderator}
\`\`\``;
        })
        .join('\n\n');

      const embedObj = betterEmbed(
        description,
        '#00ff99',
        `${historyType.charAt(0).toUpperCase() + historyType.slice(1)} History`
      );
      embedObj.builder.setFooter({ text: `Page ${page + 1} of ${Math.ceil(historyItems.length / itemsPerPage)}` });
      embedObj.builder.setTimestamp();
      return embedObj.builder;
    };

    const buildPaginationRow = (page: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('prev_page')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('next_page')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= Math.ceil(historyItems.length / itemsPerPage) - 1)
    );

    const embed = generateEmbed(currentPage);
    const row = buildPaginationRow(currentPage);

    const message = await safeReply(interaction, { embeds: [embed], components: [row], fetchReply: true });
    const ownerId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
    const collector = message.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.user.id !== ownerId) {
        await buttonInteraction.reply({ content: 'You can only use your own history buttons!', ephemeral: true });
        return;
      }
      if (buttonInteraction.customId === 'prev_page' && currentPage > 0) {
        currentPage--;
      } else if (buttonInteraction.customId === 'next_page' && currentPage < Math.ceil(historyItems.length / itemsPerPage) - 1) {
        currentPage++;
      }

      const newEmbed = generateEmbed(currentPage);
      const newRow = buildPaginationRow(currentPage);

      await buttonInteraction.update({ embeds: [newEmbed], components: [newRow] });
    });
  } catch (error) {
    console.error('Error in history command:', error);
    await safeReply(interaction, errorEmbed('There was an error retrieving the user history.', 'History Command Error'));
  }
}