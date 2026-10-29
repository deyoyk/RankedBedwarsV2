import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { SeasonManager } from '../../managers/SeasonManager';
import { safeReply } from '../../utils/safeReply';
import { errorEmbed } from '../../utils/betterembed';

export async function startseason(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager): Promise<void> {
  void wsManager;
  let seasonNumber: number;
  let chapterNumber: number;
  let name: string;
  let description: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    seasonNumber = interaction.options.getInteger('season', true);
    chapterNumber = interaction.options.getInteger('chapter', true);
    name = interaction.options.getString('name', true);
    description = interaction.options.getString('description') || '';
  } else {
    if (!args || args.length < 3) {
      await safeReply(interaction, errorEmbed('Usage: =startseason <season> <chapter> <name> [description]', 'StartSeason Usage Error'));
      return;
    }
    seasonNumber = parseInt(args[0], 10);
    chapterNumber = parseInt(args[1], 10);
    name = args[2];
    description = args.slice(3).join(' ') || '';
    if (!Number.isInteger(seasonNumber) || !Number.isInteger(chapterNumber)) {
      await safeReply(interaction, errorEmbed('Usage: =startseason <season> <chapter> <name> [description]', 'StartSeason Usage Error'));
      return;
    }
  }

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
      await safeReply(interaction, { content: result.message });
    }
  } catch (error) {
    console.error('Error starting season:', error);
    await safeReply(interaction, {
      content: 'An error occurred while starting the season. Please check the logs and try again.'
    }).catch(() => {});
  }
}

// Backward-compatible alias (previous export name).
export const executeStartSeason = startseason;
