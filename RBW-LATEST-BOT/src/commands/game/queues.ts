import { Message, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import Queue from '../../models/Queue';
import { betterEmbed, errorEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

export async function queues(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let page = 1;
  const queuesPerPage = 10;

  if (interaction instanceof ChatInputCommandInteraction) {
    page = interaction.options.getInteger('page') || 1;
  } else if (args && args.length > 0) {
    const parsedPage = parseInt(args[0]);
    if (!isNaN(parsedPage)) {
      page = parsedPage;
    }
  }

  try {
    const totalQueues = await Queue.countDocuments();
    const totalPages = Math.max(1, Math.ceil(totalQueues / queuesPerPage));
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    const skip = Math.max(0, (page - 1) * queuesPerPage);

    const queues = await Queue.find()
      .sort({ channelId: 1 })
      .skip(skip)
      .limit(queuesPerPage);

    if (queues.length === 0) {
      await safeReply(interaction, errorEmbed('There are no queues in the database.', 'No Queues Found'));
      return;
    }

    const embedObj = await createQueuesEmbed(queues, page, totalPages, totalQueues, skip);
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`queues_first_${page}`)
          .setLabel('First')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`queues_prev_${page}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`queues_next_${page}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages),
        new ButtonBuilder()
          .setCustomId(`queues_last_${page}`)
          .setLabel('Last')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages)
      );

    const response = await safeReply(interaction, {
      embeds: [embedObj.builder],
      components: totalPages > 1 ? [row] : []
    });

    if (totalPages > 1) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000
      });

      collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.user.id !== (interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id)) {
          await buttonInteraction.reply({ content: 'You can only use your own pagination buttons!', ephemeral: true });
          return;
        }
        let newPage = page;
        if (buttonInteraction.customId.startsWith('queues_first_')) {
          newPage = 1;
        } else if (buttonInteraction.customId.startsWith('queues_prev_')) {
          newPage = page - 1;
        } else if (buttonInteraction.customId.startsWith('queues_next_')) {
          newPage = page + 1;
        } else if (buttonInteraction.customId.startsWith('queues_last_')) {
          newPage = totalPages;
        }
        const newSkip = Math.max(0, (newPage - 1) * queuesPerPage);
        const newQueues = await Queue.find()
          .sort({ channelId: 1 })
          .skip(newSkip)
          .limit(queuesPerPage);
        const newEmbedObj = await createQueuesEmbed(newQueues, newPage, totalPages, totalQueues, newSkip);
        const newRow = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`queues_first_${newPage}`)
              .setLabel('First')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === 1),
            new ButtonBuilder()
              .setCustomId(`queues_prev_${newPage}`)
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === 1),
            new ButtonBuilder()
              .setCustomId(`queues_next_${newPage}`)
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === totalPages),
            new ButtonBuilder()
              .setCustomId(`queues_last_${newPage}`)
              .setLabel('Last')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === totalPages)
          );
        await buttonInteraction.update({ embeds: [newEmbedObj.builder], components: [newRow] });
        page = newPage;
      });

      collector.on('end', async () => {
        const disabledRow = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('queues_first_disabled')
              .setLabel('First')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('queues_prev_disabled')
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('queues_next_disabled')
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('queues_last_disabled')
              .setLabel('Last')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );
        try {
          await response.edit({ components: [disabledRow] });
        } catch (error) {}
      });
    }
  } catch (error) {
    console.error('Error in queues command:', error);
    await safeReply(interaction, errorEmbed('There was an error fetching the queues.', 'Error'));
  }
}

async function createQueuesEmbed(queues: any[], page: number, totalPages: number, totalQueues: number, skip: number) {
  const embedObj = betterEmbed(
    `Showing queues ${skip + 1}-${skip + queues.length} of ${totalQueues}`,
    '#00AAAA',
    'Queues'
  );

  let queuesList = '';
  for (const queue of queues) {
    queuesList += `\n <#${queue.channelId}>\n`;
    queuesList += `\`MinELO: ${queue.minElo}\` | `;
    queuesList += `\`MaxELO: ${queue.maxElo}\` | `;
    queuesList += `\`Players: ${queue.players?.length || 0}/${queue.maxPlayers}\` | `;
    queuesList += `\`Ranked: ${queue.isRanked ? 'Yes' : 'No'}\` | `;
    queuesList += `\`Picking: ${queue.ispicking ? 'Yes' : 'No'}\``;
    queuesList += '\n';
  }

  const baseDescription = embedObj.builder.data.description || '';
  const combinedDescription = `${baseDescription}\n\n${(queuesList.trim() || 'No queues found')}`;
  embedObj.builder.setDescription(combinedDescription.slice(0, 4096));
  embedObj.builder.setFooter({ text: `Page ${page}/${totalPages}` });
  embedObj.builder.setTimestamp();
  return embedObj;
}