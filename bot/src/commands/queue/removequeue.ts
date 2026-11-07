import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import { queueSystemEmbed } from '../../utils/queueEmbed';
import Queue from '../../models/Queue';
import { queuePlayers } from '../../types/queuePlayersMemory';

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
    console.error('Error in removequeue command:', error);
    await safeReply(interaction, { embeds: [queueSystemEmbed('There was an error removing the queue.', 'error')] });
  }
}
