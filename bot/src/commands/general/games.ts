import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { betterEmbed } from '../../utils/betterembed';
import Game from '../../models/Game';
import { paginate } from '../../utils/paginate';

type GameListItem = { gameId: number; state: string };

export async function games(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  await paginate<GameListItem>(interaction, {
    commandName: 'games',
    title: 'Game History',
    emptyMessage: 'There are no games in the database.',
    emptyTitle: 'No Games Found',
    perPage: 15,
    fetchPage: async (skip, limit, total) => {
      const totalCount = total ?? await Game.countDocuments();
      const items = await Game.find().sort({ gameId: -1 }).skip(skip).limit(limit).select('gameId state').lean();
      return {
        items,
        total: totalCount,
        buildEmbed: (games, page, totalPages, totalGames, skip) => {
          const embed = betterEmbed(
            `Showing games ${skip + 1}-${skip + games.length} of ${totalGames}`,
            '#00AAAA',
            'Game History'
          );

          const gamesList = games.map(game => `- **Game #${game.gameId}** - ${game.state}`).join('\n');

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
