import { Message, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { safeReply } from './safeReply';
import { errorEmbed } from './betterembed';
import { betterEmbed } from './betterembed';

export interface PaginationConfig {
  commandName: string;
  title: string;
  emptyMessage: string;
  emptyTitle: string;
  perPage: number;
  fetchPage: (skip: number, limit: number) => Promise<{ items: any[]; total: number; buildEmbed: (items: any[], page: number, totalPages: number, total: number, skip: number) => EmbedBuilder }>;
}

export async function paginate(interaction: Message | ChatInputCommandInteraction, config: PaginationConfig): Promise<void> {
  let page = 1;

  if (interaction instanceof ChatInputCommandInteraction) {
    page = interaction.options.getInteger('page') || 1;
  } else {
    const args = (interaction as Message).content?.split(' ').slice(1);
    if (args && args.length > 0) {
      const parsedPage = parseInt(args[0]);
      if (!isNaN(parsedPage)) page = parsedPage;
    }
  }

  try {
    const skip = Math.max(0, (page - 1) * config.perPage);
    const { items, total, buildEmbed } = await config.fetchPage(skip, config.perPage);

    if (items.length === 0) {
      await safeReply(interaction, errorEmbed(config.emptyMessage, config.emptyTitle));
      return;
    }

    const totalPages = Math.max(1, Math.ceil(total / config.perPage));
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;

    const embed = buildEmbed(items, page, totalPages, total, skip);
    const row = buildPaginationRow(config.commandName, page, totalPages);

    const response = await safeReply(interaction, {
      embeds: [embed],
      components: totalPages > 1 ? [row] : []
    });

    if (totalPages > 1) {
      const userId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000
      });

      collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.user.id !== userId) {
          await buttonInteraction.reply({ content: 'You can only use your own pagination buttons!', ephemeral: true });
          return;
        }

        let newPage = page;
        if (buttonInteraction.customId.startsWith(`${config.commandName}_first_`)) {
          newPage = 1;
        } else if (buttonInteraction.customId.startsWith(`${config.commandName}_prev_`)) {
          newPage = Math.max(1, page - 1);
        } else if (buttonInteraction.customId.startsWith(`${config.commandName}_next_`)) {
          newPage = Math.min(totalPages, page + 1);
        } else if (buttonInteraction.customId.startsWith(`${config.commandName}_last_`)) {
          newPage = totalPages;
        }

        const newSkip = Math.max(0, (newPage - 1) * config.perPage);
        const result = await config.fetchPage(newSkip, config.perPage);
        const newEmbed = result.buildEmbed(result.items, newPage, totalPages, total, newSkip);
        const newRow = buildPaginationRow(config.commandName, newPage, totalPages);

        await buttonInteraction.update({ embeds: [newEmbed], components: [newRow] });
        page = newPage;
      });

      collector.on('end', async () => {
        const disabledRow = buildDisabledPaginationRow(config.commandName);
        try {
          await response.edit({ components: [disabledRow] });
        } catch {}
      });
    }
  } catch (error) {
    console.error(`Error in ${config.commandName} command:`, error);
    await safeReply(interaction, errorEmbed(`There was an error fetching the data.`, 'Error'));
  }
}

function buildPaginationRow(commandName: string, page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${commandName}_first_${page}`).setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId(`${commandName}_prev_${page}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
    new ButtonBuilder().setCustomId(`${commandName}_next_${page}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages),
    new ButtonBuilder().setCustomId(`${commandName}_last_${page}`).setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(page === totalPages)
  );
}

function buildDisabledPaginationRow(commandName: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${commandName}_first_disabled`).setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${commandName}_prev_disabled`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${commandName}_next_disabled`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`${commandName}_last_disabled`).setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(true)
  );
}
