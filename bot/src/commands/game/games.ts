import { Message, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { betterEmbed } from '../../utils/betterembed';
import Game from '../../models/Game';
import { paginate } from '../../utils/paginate';

export async function games(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  await paginate(interaction, {
    commandName: 'games',
    title: 'Game History',
    emptyMessage: 'There are no games in the database.',
    emptyTitle: 'No Games Found',
    perPage: 15,
    fetchPage: async (skip, limit) => {
      const total = await Game.countDocuments();
      const items = await Game.find().sort({ gameId: -1 }).skip(skip).limit(limit);
      return {
        items,
        total,
        buildEmbed: (games, page, totalPages, totalGames, skip) => {
          const embed = betterEmbed(
            `Showing games ${skip + 1}-${skip + games.length} of ${totalGames}`,
            '#00AAAA',
            'Game History'
          );

          const gamesList = games.map(game => {
            let statusText = '';
            switch (game.state) {
              case 'scored': statusText = '``scored``'; break;
              case 'voided': statusText = '``voided``'; break;
              case 'pending': default: statusText = '``pending``'; break;
            }
            return `\n #${game.gameId} ${statusText} `;
          }).join(' \u2022 ');

          embed.builder.addFields({
            name: 'Games',
            value: gamesList || 'No games found',
            inline: false
          });

          return embed.builder;
        }
      };
    }
  });
}
