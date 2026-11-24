import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { replyCommandError } from '../../utils/errorReporter';
import { safeReply } from '../../utils/safeReply';
import { queueSystemEmbed } from '../../utils/queueEmbed';
import Queue from '../../models/Queue';
import { queuePlayers } from '../../types/queuePlayersMemory';
import { auditInteractionContext, recordAudit } from '../../services/AuditService';

export async function removequeue(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let channelId: string;

  
    channelId = interaction.options.getString('channel_id', true);
  

  try {
    const queue = await Queue.findOneAndDelete({ channelId });

    if (!queue) {
      await safeReply(interaction, { embeds: [queueSystemEmbed('No queue found with the specified channel ID.', 'error')] });
      return;
    }

    queuePlayers.delete(channelId);

    await recordAudit({
      ...auditInteractionContext(interaction),
      action: 'queue.remove',
      category: 'queue',
      source: 'discord',
      success: true,
      targetType: 'queue',
      targetId: channelId,
      before: { channelId, maxPlayers: queue.maxPlayers, minElo: queue.minElo, maxElo: queue.maxElo, isRanked: queue.isRanked, isPicking: queue.isPicking },
    });

    await safeReply(interaction, {
      embeds: [queueSystemEmbed([
        'The queue has been successfully removed!',
        `**Channel:** <#${channelId}>`,
        `**Max Players:** ${queue.maxPlayers}`,
        `**ELO Range:** ${queue.minElo}-${queue.maxElo}`,
        `**Queue Type:** ${queue.isRanked ? 'Ranked' : 'Casual'}`,
        `**Picking:** ${queue.isPicking ? 'Enabled' : 'Disabled'}`,
      ], 'success')]
    });
  } catch (error) {
    await replyCommandError(interaction, error, 'remove the queue', '[removequeue]');
  }
}
