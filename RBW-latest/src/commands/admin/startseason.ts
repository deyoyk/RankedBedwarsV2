import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import Season from '../../models/Season';
import User from '../../models/User';
import Game from '../../models/Game';

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
    
    const activeSeason = await Season.findOne({ isActive: true });
    if (activeSeason) {
      const embed = new EmbedBuilder()
        .setColor('#00AAAA')
        .setTitle('❌ Error')
        .setDescription(`There is already an active season: **${activeSeason.name}** (Season ${activeSeason.seasonNumber} Chapter ${activeSeason.chapterNumber})\nPlease end the current season first using \`/endseason\``);
      
      await safeReply(interaction, { embeds: [embed], ephemeral: true });      return;
    }

    
    const existingSeason = await Season.findOne({ seasonNumber, chapterNumber });
    if (existingSeason) {
      const embed = new EmbedBuilder()
        .setColor('#00AAAA')
        .setTitle('❌ Error')
        .setDescription(`Season ${seasonNumber} Chapter ${chapterNumber} already exists!`);
      
      await safeReply(interaction, { embeds: [embed], ephemeral: true });      return;
    }

    
    const newSeason = new Season({
      seasonNumber,
      chapterNumber,
      name,
      startDate: new Date(),
      isActive: true,
      description
    });

    await newSeason.save();

    
    await User.updateMany({}, { seasonNumber, chapterNumber });

    
    await Game.updateMany({}, { seasonNumber, chapterNumber });

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('🎉 Season Started!')
      .setDescription(`**${name}** has been started as Season ${seasonNumber} Chapter ${chapterNumber}`)
      .addFields(
        { name: 'Season', value: `${seasonNumber}`, inline: true },
        { name: 'Chapter', value: `${chapterNumber}`, inline: true },
        { name: 'Start Date', value: `<t:${Math.floor(newSeason.startDate.getTime() / 1000)}:F>`, inline: true },
        { name: 'Description', value: description || 'No description provided', inline: false }
      )
      .setTimestamp();

    await safeReply(interaction, { embeds: [embed] });
  } catch (error) {
    console.error('Error starting season:', error);
    
    
    if (!interaction.replied && !interaction.deferred) {
      const embed = new EmbedBuilder()
        .setColor('#00AAAA')
        .setTitle('❌ Error')
        .setDescription('An error occurred while starting the season. Please try again.');
      
      await safeReply(interaction, { embeds: [embed], ephemeral: true });    }
  }
}