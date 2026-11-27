import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { embedsFor } from '../../utils/betterembed';
import Game from '../../models/Game';
import User from '../../models/User';
import { paginate } from '../../utils/paginate';

const { betterEmbed } = embedsFor('Game');

type GameListItem = { gameId: number; state: string };

export function gamesFilter(discordId?: string) {
  return discordId ? { $or: [{ team1: discordId }, { team2: discordId }] } : {};
}

export async function games(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  const player = interaction.options.getUser('user');
  const filter = gamesFilter(player?.id);
  let name = player?.username;
  if (player) {
    const linked = await User.findOne({ discordId: player.id }).select('ign').lean();
    if (linked?.ign) name = linked.ign;
  }
  const title = name ? `${name}'s Game History` : 'Game History';

  await paginate<GameListItem>(interaction, {
    commandName: 'games',
    title,
    emptyMessage: name ? `${name} hasn't played any games.` : 'There are no games in the database.',
    emptyTitle: 'No Games Found',
    perPage: 15,
    fetchPage: async (skip, limit, total) => {
      const totalCount = total ?? await Game.countDocuments(filter);
      const items = await Game.find(filter).sort({ gameId: -1 }).skip(skip).limit(limit).select('gameId state').lean();
      return {
        items,
        total: totalCount,
        buildEmbed: (games, page, totalPages, totalGames, skip) => {
          const embed = betterEmbed(
            `Showing games ${skip + 1}-${skip + games.length} of ${totalGames}`,
            '#00AAAA',
            title
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
