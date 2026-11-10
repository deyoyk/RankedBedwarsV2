import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { safeReply } from '../../utils/safeReply';
import User, { IUser } from '../../models/User';
import { IRecentGame } from '../../models/gameBase';
import { errorEmbed, infoEmbed } from '../../utils/betterembed';
import { RecentGameResult, resolveRecentGameResult } from '../../utils/recentGameResult';

interface RecentGamesData {
  page: number;
  gamesPerPage: number;
  userFilter?: string;
  requesterId: string;
}

export async function recentgames(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  try {
    const data = await parseRecentGamesRequest(interaction);
    if (!data) return;

    const user = await findUser(data);
    if (!user) {
      await safeReply(interaction, errorEmbed(
        data.userFilter ? `No user found: ${data.userFilter}` : 'User not found.',
        'Recent Games Error'
      ));
      return;
    }

    await displayRecentGames(interaction, user, data);
  } catch (error) {
    console.error('Error in recentgames command:', error);
    await safeReply(interaction, errorEmbed('An error occurred while fetching recent games.', 'Recent Games Error'));
  }
}

async function parseRecentGamesRequest(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager): Promise<RecentGamesData | null> {
  const requesterId = interaction.user.id;
  const page = Math.max(0, (interaction.options.getInteger('page') || 1) - 1);
  const userFilter = interaction.options.getString('user') || undefined;

  return { page, gamesPerPage: 15, userFilter, requesterId };
}

async function findUser(data: RecentGamesData): Promise<RecentGamesUser | null> {
  if (data.userFilter) {
    return await User.findOne({
      $or: [
        { discordId: data.userFilter },
        { ign: data.userFilter },
        { discordId: data.userFilter.replace(/[<@!>]/g, '') }
      ]
    }).select('discordId ign recentGames').lean();
  } else {
    return await User.findOne({ discordId: data.requesterId }).select('discordId ign recentGames').lean();
  }
}

type RecentGamesUser = Pick<IUser, 'discordId' | 'ign' | 'recentGames'>;

async function displayRecentGames(interaction: ChatInputCommandInteraction, user: RecentGamesUser, data: RecentGamesData) {
  if (!user.recentGames || user.recentGames.length === 0) {
    const embed = createNoGamesEmbed(data.userFilter);
    await safeReply(interaction, { embeds: [embed] });
    return;
  }

  const totalPages = Math.ceil(user.recentGames.length / data.gamesPerPage);
  const currentPage = Math.min(data.page, totalPages - 1);
  const startIndex = currentPage * data.gamesPerPage;
  const endIndex = Math.min(startIndex + data.gamesPerPage, user.recentGames.length);
  const games = user.recentGames.slice(startIndex, endIndex);

  const embed = createRecentGamesEmbed(user, games, currentPage, totalPages, startIndex, endIndex);
  const components = createPaginationComponents(currentPage, totalPages);

  await safeReply(interaction, { embeds: [embed], components });

  if (totalPages > 1) {
    await setupPaginationCollector(interaction, user, data, totalPages);
  }
}

function createNoGamesEmbed(userFilter?: string): EmbedBuilder {
  return infoEmbed(
    userFilter ? `No recent games found for user: ${userFilter}` : 'There are no recent games in the database.',
    'No Recent Games'
  ).builder;
}

function createRecentGamesEmbed(user: RecentGamesUser, games: IRecentGame[], currentPage: number, totalPages: number, startIndex: number, endIndex: number): EmbedBuilder {
  const pageLine = totalPages > 1 ? `\n\n**Page:** ${currentPage + 1}/${totalPages}` : '';
  const embed = infoEmbed(
    `Showing games ${startIndex + 1}-${endIndex} of ${user.recentGames.length}.${pageLine}`,
    `Recent Games - ${user.ign || user.discordId}`
  ).builder;

  const gamesList = formatGamesList(games);
  embed.addFields({
    name: 'Games',
    value: gamesList || 'No games found',
    inline: false
  });

  return embed;
}

function formatGamesList(games: IRecentGame[]): string {
  return games.map(game => {
    const result = resolveRecentGameResult(game);
    const bedBroken = game.bedBroken || 0;
    const bedSuffix = bedBroken > 0 ? ` - ${bedBroken} ${bedBroken === 1 ? 'bed' : 'beds'}` : '';
    const stats = `${game.kills || 0}/${bedBroken}/${game.finalKills || 0}`;
    return `${formatElo(game, result)} - ${formatGameTime(game)} - [#${game.gameId}] ${game.map || 'Unknown Map'} - [${getResultText(result)}] - ${stats}${bedSuffix}`;
  }).join('\n');
}

function formatElo(game: IRecentGame, result: RecentGameResult): string {
  const elo = Number.isFinite(game.eloGain) ? game.eloGain : 0;
  if (elo === 0 || (result !== 'win' && result !== 'lose')) return '[—]';
  return elo > 0 ? `[+${elo}]` : `[${elo}]`;
}

function formatGameTime(game: IRecentGame): string {
  const timestamp = new Date(game.endTime ?? game.date ?? game.startTime).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

function getResultText(result: RecentGameResult): string {
  switch (result) {
    case 'win':
      return 'Win';
    case 'lose':
      return 'Loss';
    case 'voided':
      return 'Voided';
    case 'pending':
      return 'Ongoing';
    default:
      return 'Unknown';
  }
}

function createPaginationComponents(currentPage: number, totalPages: number): ActionRowBuilder<ButtonBuilder>[] {
  if (totalPages <= 1) return [];

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('recentgames_prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('recentgames_next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === totalPages - 1)
    );

  return [row];
}

async function setupPaginationCollector(interaction: ChatInputCommandInteraction, user: RecentGamesUser, data: RecentGamesData, totalPages: number) {
  const collector = interaction.channel?.createMessageComponentCollector({ 
    time: 300000,
    filter: (i) => i.user.id === data.requesterId
  });

  if (!collector) return;

  let currentPage = data.page;

  collector.on('collect', async (i) => {
    try {
      if (i.customId === 'recentgames_prev' && currentPage > 0) {
        currentPage--;
      } else if (i.customId === 'recentgames_next' && currentPage < totalPages - 1) {
        currentPage++;
      }

      const startIndex = currentPage * data.gamesPerPage;
      const endIndex = Math.min(startIndex + data.gamesPerPage, user.recentGames.length);
      const games = user.recentGames.slice(startIndex, endIndex);

      const embed = createRecentGamesEmbed(user, games, currentPage, totalPages, startIndex, endIndex);
      const components = createPaginationComponents(currentPage, totalPages);

      await i.update({ embeds: [embed], components });
    } catch (error) {
      console.error('Error handling pagination:', error);
      await i.reply(errorEmbed('An error occurred while updating the page.', 'Recent Games Error', true));
    }
  });

  collector.on('end', async () => {
    try {
      if (interaction.replied) {
        const { safeReply } = await import('../../utils/safeReply');
        await safeReply(interaction, { components: [] });
      }
    } catch (error) {
      console.error('Error cleaning up pagination:', error);
    }
  });
}