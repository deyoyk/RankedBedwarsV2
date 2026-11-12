import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import Season from '../../models/Season';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';

const { errorEmbed, infoEmbed } = embedsFor('Season');

export async function listseasons(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  void _wsManager;
  try {
    const seasons = await Season.find({}).sort({ seasonNumber: 1, chapterNumber: 1 });

    if (seasons.length === 0) {
      await safeReply(interaction, { embeds: [infoEmbed('No seasons have been created yet.', 'Seasons List').builder] });
      return;
    }

    const embeds = [];
    for (let i = 0; i < seasons.length; i += 25) {
      const chunk = seasons.slice(i, i + 25);
      const chunkEmbed = infoEmbed(
        'List of all seasons in the system',
        i === 0 ? 'All Seasons' : `All Seasons (${i + 1}-${i + chunk.length})`
      ).builder;

      chunk.forEach(season => {
        const status = season.isActive ? 'Active' : 'Ended';
        const endDate = season.endDate ? `<t:${Math.floor(season.endDate.getTime() / 1000)}:D>` : 'N/A';

        chunkEmbed.addFields({
          name: `Season ${season.seasonNumber} Chapter ${season.chapterNumber}: ${season.name}`,
          value: `**Status:** ${status}\n**Start:** <t:${Math.floor(season.startDate.getTime() / 1000)}:D>\n**End:** ${endDate}\n**Description:** ${season.description || 'No description'}`,
          inline: false
        });
      });
      embeds.push(chunkEmbed);
    }

    await safeReply(interaction, { embeds });
  } catch (error) {
    console.error('Error listing seasons:', error);
    await safeReply(interaction, {
      embeds: [errorEmbed('An error occurred while fetching seasons.', 'Seasons List Error').builder],
      ephemeral: true
    });
  }
}

export const executeListSeasons = listseasons;
export const executeListseasons = listseasons;
