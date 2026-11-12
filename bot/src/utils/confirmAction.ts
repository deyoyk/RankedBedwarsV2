import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, ComponentType, EmbedField, Message } from 'discord.js';
import { safeReply } from './safeReply';
import { embedsFor } from './betterembed';

const { errorEmbed, successEmbed, themedEmbed } = embedsFor('Command');

export interface ConfirmActionConfig {
  commandName: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmLabel: string;
  confirmStyle: ButtonStyle;
  fields: EmbedField[];
  startMessage: string;
  cancelMessage: string;
  onConfirm: () => Promise<void>;
}

export async function executeWithConfirmation(
  interaction: Message | ChatInputCommandInteraction,
  config: ConfirmActionConfig
): Promise<void> {
  if (!interaction.guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', `${config.commandName} Error`));
    return;
  }

  const userId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;

  try {
    const confirmEmbed = themedEmbed('warning')
      .setTitle(config.confirmTitle)
      .setDescription(`${config.confirmDescription}\n\n**Expires:** 30 seconds`)
      .addFields(config.fields);

    const confirmButton = new ButtonBuilder()
      .setCustomId(`${config.commandName}_confirm`)
      .setLabel(config.confirmLabel)
      .setStyle(config.confirmStyle);

    const denyButton = new ButtonBuilder()
      .setCustomId(`${config.commandName}_deny`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(confirmButton, denyButton);

    const response = await safeReply(interaction, {
      embeds: [confirmEmbed],
      components: [row],
      fetchReply: true
    });
    if (!response) return;

    const message = response instanceof Message ? response : response;

    try {
      const confirmation = await message.awaitMessageComponent({
        filter: (i) => {
          return (i.customId === `${config.commandName}_confirm` || i.customId === `${config.commandName}_deny`) && 
                 i.user.id === userId;
        },
        time: 30000,
        componentType: ComponentType.Button
      });

      if (confirmation.customId === `${config.commandName}_deny`) {
        await confirmation.update({
          embeds: [errorEmbed(config.cancelMessage, 'Operation Cancelled').builder],
          components: []
        });
        return;
      }

      await confirmation.update({
        embeds: [successEmbed(config.startMessage, `${config.commandName} Started`).builder],
        components: []
      });

      await config.onConfirm();

    } catch {
      const timeoutEmbed = themedEmbed('warning')
        .setTitle('Confirmation Expired')
        .setDescription('The confirmation has expired. Please run the command again if you want to proceed.');

      await message.edit({
        embeds: [timeoutEmbed],
        components: []
      });
    }

  } catch (error) {
    console.error(`[${config.commandName}] Error in ${config.commandName} command:`, error);
    const detail = error instanceof Error ? error.message : 'Unknown error';
    await safeReply(interaction, errorEmbed(`There was an error running ${config.commandName}: ${detail}`, `${config.commandName} Error`));
  }
}
