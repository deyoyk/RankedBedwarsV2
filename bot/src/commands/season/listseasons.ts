import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import Season from '../../models/Season';
import { safeReply } from '../../utils/safeReply';

export async function executeListSeasons(interaction: ChatInputCommandInteraction) {
  try {
    const seasons = await Season.find({}).sort({ seasonNumber: 1, chapterNumber: 1 });
    
    if (seasons.length === 0) {
      const embed = new EmbedBuilder()
        .setColor('#ff9900')
        .setTitle('Seasons List')
        .setDescription('No seasons have been created yet.');
      
      return interaction.reply({ embeds: [embed] });
    }

    const embeds = [];
    for (let i = 0; i < seasons.length; i += 25) {
      const chunk = seasons.slice(i, i + 25);
      const chunkEmbed = new EmbedBuilder()
        .setColor('#00AAAA')
        .setTitle(i === 0 ? 'All Seasons' : `All Seasons (${i + 1}-${i + chunk.length})`)
        .setDescription('List of all seasons in the system')
        .setTimestamp();

      chunk.forEach(season => {
        const status = season.isActive ? '🟢 Active' : '🔴 Ended';
        const endDate = season.endDate ? `<t:${Math.floor(season.endDate.getTime() / 1000)}:D>` : 'N/A';

        chunkEmbed.addFields({
          name: `Season ${season.seasonNumber} Chapter ${season.chapterNumber}: ${season.name}`,
          value: `${status}\n**Start:** <t:${Math.floor(season.startDate.getTime() / 1000)}:D>\n**End:** ${endDate}\n**Description:** ${season.description || 'No description'}`,
          inline: false
        });
      });
      embeds.push(chunkEmbed);
    }

    safeReply(interaction, { embeds });
  } catch (error) {
    console.error('Error listing seasons:', error);
    
    const embed = new EmbedBuilder()
      .setColor('#00AAAA')
      .setTitle('❌ Error')
      .setDescription('An error occurred while fetching seasons.');
    
    await safeReply(interaction, { embeds: [embed], ephemeral: true });  }
}