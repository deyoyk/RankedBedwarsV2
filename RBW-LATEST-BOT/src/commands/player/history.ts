import { Message, ChatInputCommandInteraction, EmbedBuilder, MessageReaction, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import User from '../../models/User';


import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

export async function history(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let discordId: string;
  let historyType: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    discordId = interaction.options.getString('userid', true);
    historyType = interaction.options.getString('type', true).toLowerCase();
  } else {
    if (args && args.length >= 2) {
      const userInput = args[0];
      discordId = userInput.replace(/[<@!>]/g, '');
      historyType = args[1].toLowerCase();

      const user = await User.findOne({
        $or: [
          { discordId },
          { ign: userInput }
        ]
      });

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

  try {
    const user = await User.findOne({ discordId });
    if (!user) {
      await safeReply(interaction, errorEmbed('No user found with the specified ID.', 'History Not Found'));
      return;
    }

    let historyItems;
    if (historyType === 'ban') {
      historyItems = user.bans;
    } else if (historyType === 'mute') {
      historyItems = user.mutes;
    } else if (historyType === 'strike') {
      historyItems = user.strikes;
    } else {
      await safeReply(interaction, errorEmbed('Valid types are: `ban`, `mute`, `strike`.', 'Invalid History Type'));
      return;
    }

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

    const embed = generateEmbed(currentPage);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('prev_page')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('next_page')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage >= Math.ceil(historyItems.length / itemsPerPage) - 1)
    );

    const message = await safeReply(interaction, { embeds: [embed], components: [row], fetchReply: true });
    const collector = message.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.customId === 'prev_page' && currentPage > 0) {
        currentPage--;
      } else if (buttonInteraction.customId === 'next_page' && currentPage < Math.ceil(historyItems.length / itemsPerPage) - 1) {
        currentPage++;
      }

      const newEmbed = generateEmbed(currentPage);
      const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('prev_page')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId('next_page')
          .setLabel('Next')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage >= Math.ceil(historyItems.length / itemsPerPage) - 1)
      );

      await buttonInteraction.update({ embeds: [newEmbed], components: [newRow] });
    });
  } catch (error) {
    console.error('Error in history command:', error);
    await safeReply(interaction, errorEmbed('There was an error retrieving the user history.', 'History Command Error'));
  }
}