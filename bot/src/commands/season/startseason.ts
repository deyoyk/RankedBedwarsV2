import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { SeasonManager } from '../../managers/SeasonManager';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';

const { errorEmbed, successEmbed } = embedsFor('Season');

export async function startseason(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<void> {
  void _wsManager;
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
      await safeReply(interaction, { embeds: [result.embed] });
    } else {
      const embed = result.success
        ? successEmbed(result.message, 'Season Started')
        : errorEmbed(result.message, 'Season Start Failed');
      await safeReply(interaction, embed);
    }
  } catch (error) {
    console.error('Error starting season:', error);
    await safeReply(interaction, errorEmbed(
      'An error occurred while starting the season. Please check the logs and try again.',
      'Season Start Error'
    )).catch(() => {});
  }
}

export const executeStartSeason = startseason;
