import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import Queue from '../../models/Queue';
import { queueSystemEmbed } from '../../utils/queueEmbed';
import { paginate } from '../../utils/paginate';
import { queuePlayers } from '../../types/queuePlayersMemory';

type QueueListItem = {
  channelId: string;
  minElo: number;
  maxElo: number;
  maxPlayers: number;
  isRanked?: boolean;
  isPicking?: boolean;
};

export async function queues(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  await paginate<QueueListItem>(interaction, {
    commandName: 'queues',
    title: 'Queue System',
    emptyMessage: 'There are no queues in the database.',
    emptyTitle: 'Queue System',
    perPage: 10,
    buildEmptyEmbed: () => queueSystemEmbed('There are no queues in the database.', 'error'),
    fetchPage: async (skip, limit, total) => {
      const totalCount = total ?? await Queue.countDocuments();
      const items = await Queue.find().sort({ channelId: 1 }).skip(skip).limit(limit).select('channelId minElo maxElo maxPlayers isRanked isPicking').lean();
      return {
        items,
        total: totalCount,
        buildEmbed: (queues, page, totalPages, totalQueues, skip) => {
          const lines = [`Showing queues ${skip + 1}-${skip + queues.length} of ${totalQueues}`];

          for (const queue of queues) {
            lines.push(
              `<#${queue.channelId}>`,
              `MinELO \`${queue.minElo}\` · MaxELO \`${queue.maxElo}\` · Players \`${queuePlayers.get(queue.channelId)?.length || 0}/${queue.maxPlayers}\` · Ranked \`${queue.isRanked ? 'Yes' : 'No'}\` · Picking \`${queue.isPicking ? 'Yes' : 'No'}\``,
            );
          }

          const embed = queueSystemEmbed(lines);
          embed.setFooter({ text: `Page ${page}/${totalPages}` });
          return embed;
        }
      };
    }
  });
}
