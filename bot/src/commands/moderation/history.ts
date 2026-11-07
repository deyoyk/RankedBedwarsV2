import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Message } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { betterEmbed, errorEmbed, infoEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

interface HistoryRecordView {
  reason: string;
  date: Date;
  duration?: number | null;
  moderator: string;
}

export async function history(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let discordId: string;
  let historyType: string;
  const userInput: string | null = null;

  
    discordId = interaction.options.getString('user_id', true);
    historyType = interaction.options.getString('type', true).toLowerCase();
  

  if (!['ban', 'mute', 'strike'].includes(historyType)) {
    await safeReply(interaction, errorEmbed('Valid types are: `ban`, `mute`, `strike`.', 'Invalid History Type'));
    return;
  }
  const recordsField = historyType === 'ban' ? 'bans' : historyType === 'mute' ? 'mutes' : 'strikes';

  if (userInput !== null) {
    const isIdLike = /^<@!?\d+>$/.test(userInput) || /^\d+$/.test(userInput);
    const idRow = isIdLike
      ? await User.findOne({ discordId }).select('discordId').lean()
      : await User.findOne({ ign: userInput }).collation({ locale: 'en', strength: 2 }).select('discordId').lean();

    if (!idRow) {
      await safeReply(interaction, {
        embeds: [errorEmbed('No user found with the specified ID, mention, or IGN.', 'History Not Found').builder]
      });
      return;
    }

    discordId = idRow.discordId;
  }

  try {
    const itemsPerPage = 5;

    const loadPage = async (page: number): Promise<{ items: HistoryRecordView[]; total: number; totalPages: number }> => {
      const [agg] = await User.aggregate([
        { $match: { discordId } },
        {
          $project: {
            _id: 0,
            items: { $slice: [{ $ifNull: [`$${recordsField}`, []] }, page * itemsPerPage, itemsPerPage] },
            total: { $size: { $ifNull: [`$${recordsField}`, []] } }
          }
        }
      ]);
      const total: number = agg?.total ?? 0;
      return {
        items: ((agg?.items ?? []) as HistoryRecordView[]),
        total,
        totalPages: Math.max(1, Math.ceil(total / itemsPerPage))
      };
    };

    let currentPage = 0;
    let { items: pageItems, total: totalCount, totalPages } = await loadPage(0);
    if (totalCount === 0) {
      await safeReply(interaction, infoEmbed(`No ${historyType}s found for <@${discordId}>.`, 'No History Found'));
      return;
    }

    const generateEmbed = (page: number, items: HistoryRecordView[], pages: number, count: number) => {
      const description = items
        .map((item, index) => {
          const duration = 'duration' in item ? item.duration : 'N/A';
          return `\`\`\`
${index + 1 + page * itemsPerPage}. Reason: ${item.reason}
Date: ${new Date(item.date).toDateString()}
Duration: ${duration}
Moderator: ${item.moderator}
\`\`\``;
        })
        .join('\n\n');

      const embedObj = betterEmbed(
        `History for <@${discordId}>.\n\n${description}\n\n**Page:** ${page + 1}/${pages} (${count} total)`,
        'info',
        `${historyType.charAt(0).toUpperCase() + historyType.slice(1)} History`
      );
      return embedObj.builder;
    };

    const buildPaginationRow = (page: number, pages: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('prev_page')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('next_page')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(page >= pages - 1)
    );

    const embed = generateEmbed(currentPage, pageItems, totalPages, totalCount);
    const row = buildPaginationRow(currentPage, totalPages);

    const message = await safeReply(interaction, { embeds: [embed], components: [row], fetchReply: true });
    const ownerId = interaction.user.id;
    const collector = (message as unknown as Message | undefined)?.createMessageComponentCollector({
      filter: (i) => i.user.id === ownerId,
      time: 60000
    });

    collector?.on('collect', async (buttonInteraction) => {
      if (buttonInteraction.customId === 'prev_page' && currentPage > 0) {
        currentPage--;
      } else if (buttonInteraction.customId === 'next_page' && currentPage < totalPages - 1) {
        currentPage++;
      } else {
        await buttonInteraction.deferUpdate().catch(() => undefined);
        return;
      }

      try {
        const loaded = await loadPage(currentPage);
        pageItems = loaded.items;
        totalCount = loaded.total;
        totalPages = loaded.totalPages;
        if (pageItems.length === 0 && currentPage > 0) {
          currentPage = totalPages - 1;
          const retry = await loadPage(currentPage);
          pageItems = retry.items;
          totalCount = retry.total;
          totalPages = retry.totalPages;
        }
        await buttonInteraction.update({
          embeds: [generateEmbed(currentPage, pageItems, totalPages, totalCount)],
          components: [buildPaginationRow(currentPage, totalPages)]
        });
      } catch {
        await buttonInteraction.deferUpdate().catch(() => undefined);
      }
    });

    collector?.on('end', async () => {
      await (message as unknown as Message | undefined)?.edit({ components: [] }).catch(() => undefined);
    });
  } catch (error) {
    console.error('Error in history command:', error);
    await safeReply(interaction, errorEmbed('There was an error retrieving the user history.', 'History Command Error'));
  }
}