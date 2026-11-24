import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { SeasonManager } from '../../managers/SeasonManager';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { embedsFor } from '../../utils/betterembed';
import { auditInteractionContext, recordAudit } from '../../services/AuditService';

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

    await recordAudit({
      ...auditInteractionContext(interaction),
      action: 'season.start',
      category: 'season',
      source: 'discord',
      success: result.success,
      targetType: 'season',
      targetId: `${seasonNumber}:${chapterNumber}`,
      reason: result.message,
      after: result.success ? { seasonNumber, chapterNumber, name, description } : undefined,
      error: result.success ? undefined : result.message,
    });
  } catch (error) {
    await replyCommandError(interaction, error, 'start the season', '[startseason]');
  }
}

export const executeStartSeason = startseason;
