import { Message, ChatInputCommandInteraction } from 'discord.js';
import Queue from '../../models/Queue';
import { betterEmbed } from '../../utils/betterembed';
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

export async function queues(interaction: Message | ChatInputCommandInteraction, _args?: string[]) {
  await paginate<QueueListItem>(interaction, {
    commandName: 'queues',
    title: 'Queues',
    emptyMessage: 'There are no queues in the database.',
    emptyTitle: 'No Queues Found',
    perPage: 10,
    fetchPage: async (skip, limit, total) => {
      const totalCount = total ?? await Queue.countDocuments();
      const items = await Queue.find().sort({ channelId: 1 }).skip(skip).limit(limit).select('channelId minElo maxElo maxPlayers isRanked isPicking').lean();
      return {
        items,
        total: totalCount,
        buildEmbed: (queues, page, totalPages, totalQueues, skip) => {
          const embedObj = betterEmbed(
            `Showing queues ${skip + 1}-${skip + queues.length} of ${totalQueues}`,
            '#00AAAA',
            'Queues'
          );

          let queuesList = '';
          for (const queue of queues) {
            queuesList += `\n <#${queue.channelId}>\n`;
            queuesList += `\`MinELO: ${queue.minElo}\` | `;
            queuesList += `\`MaxELO: ${queue.maxElo}\` | `;
            queuesList += `\`Players: ${queuePlayers.get(queue.channelId)?.length || 0}/${queue.maxPlayers}\` | `;
            queuesList += `\`Ranked: ${queue.isRanked ? 'Yes' : 'No'}\` | `;
            queuesList += `\`Picking: ${queue.isPicking ? 'Yes' : 'No'}\``;
            queuesList += '\n';
          }

          const baseDescription = embedObj.builder.data.description || '';
          const combinedDescription = `${baseDescription}\n\n${(queuesList.trim() || 'No queues found')}`;
          embedObj.builder.setDescription(combinedDescription.slice(0, 4096));
          embedObj.builder.setFooter({ text: `Page ${page}/${totalPages}` });
          embedObj.builder.setTimestamp();
          return embedObj.builder;
        }
      };
    }
  });
}
