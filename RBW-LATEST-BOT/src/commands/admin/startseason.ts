import { ChatInputCommandInteraction } from 'discord.js';
import { SeasonManager } from '../../managers/SeasonManager';

export async function executeStartSeason(interaction: ChatInputCommandInteraction) {
  const seasonNumber = interaction.options.getInteger('season', true);
  const chapterNumber = interaction.options.getInteger('chapter', true);
  const name = interaction.options.getString('name', true);
  const description = interaction.options.getString('description') || '';

  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await SeasonManager.startSeason({
      seasonNumber,
      chapterNumber,
      name,
      description
    });

    if (result.embed) {
      await interaction.editReply({ embeds: [result.embed] });
    } else {
      await interaction.editReply({ content: result.message });
    }
  } catch (error) {
    console.error('Error starting season:', error);
    await interaction.editReply({
      content: 'An error occurred while starting the season. Please check the logs and try again.'
    }).catch(() => {});
  }
}
