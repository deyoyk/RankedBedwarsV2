import { ChatInputCommandInteraction } from 'discord.js';
import { SeasonManager } from '../../managers/SeasonManager';

export async function execute(interaction: ChatInputCommandInteraction) {
  const seasonNumber = interaction.options.getInteger('season', true);
  const chapterNumber = interaction.options.getInteger('chapter', true);
  const name = interaction.options.getString('name', true);
  const description = interaction.options.getString('description') || '';

  try {
    const result = await SeasonManager.startSeason({
      seasonNumber,
      chapterNumber,
      name,
      description
    });

    if (result.embed) {
      await interaction.reply({ embeds: [result.embed], ephemeral: !result.success });
    } else {
      await interaction.reply({ content: result.message, ephemeral: !result.success });
    }
  } catch (error) {
    console.error('Error starting season:', error);
    
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ 
        content: 'An error occurred while starting the season. Please check the logs and try again.', 
        ephemeral: true 
      });
    }
  }
}