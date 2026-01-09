import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { SeasonManager } from '../../managers/SeasonManager';

export const data = new SlashCommandBuilder()
  .setName('startseason')
  .setDescription('Start a new season')
  .addIntegerOption(option =>
    option.setName('season')
      .setDescription('Season number')
      .setRequired(true))
  .addIntegerOption(option =>
    option.setName('chapter')
      .setDescription('Chapter number')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('name')
      .setDescription('Name of the new season')
      .setRequired(true))
  .addStringOption(option =>
    option.setName('description')
      .setDescription('Description of the new season')
      .setRequired(false));

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