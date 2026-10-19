import { Message, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { betterEmbed, errorEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import User, { IUser } from '../../models/User';

interface RecentGamesData {
  page: number;
  gamesPerPage: number;
  userFilter?: string;
  requesterId: string;
}

interface GameDisplayData {
  gameId: number;
  state: string;
  eloGain: number;
  map?: string;
  date?: Date;
}

export async function recentgames(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  try {
    const data = await parseRecentGamesRequest(interaction, args);
    if (!data) return;

    const user = await findUser(data);
    if (!user) {
      await safeReply(interaction, { 
        content: data.userFilter ? `No user found: ${data.userFilter}` : 'User not found.' 
      });
      return;
    }

    await displayRecentGames(interaction, user, data);
  } catch (error) {
    console.error('Error in recentgames command:', error);
    await safeReply(interaction, { content: 'An error occurred while fetching recent games.' });
  }
}

async function parseRecentGamesRequest(interaction: Message | ChatInputCommandInteraction, args?: string[]): Promise<RecentGamesData | null> {
  const requesterId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
  let page = 0;
  let userFilter: string | undefined;

  if (interaction instanceof ChatInputCommandInteraction) {
    page = Math.max(0, (interaction.options.getInteger('page') || 1) - 1);
    userFilter = interaction.options.getString('user') || undefined;
  } else if (args && args.length > 0) {
    const parsedPage = parseInt(args[0]);
    if (!isNaN(parsedPage) && parsedPage > 0) {
      page = parsedPage - 1;
    }
    userFilter = args[1];
  }

  return { page, gamesPerPage: 15, userFilter, requesterId };
}

async function findUser(data: RecentGamesData): Promise<IUser | null> {
  if (data.userFilter) {
    return await User.findOne({
      $or: [
        { discordId: data.userFilter },
        { ign: data.userFilter },
        { discordId: data.userFilter.replace(/[<@!>]/g, '') }
      ]
    });
  } else {
    return await User.findOne({ discordId: data.requesterId });
  }
}

async function displayRecentGames(interaction: Message | ChatInputCommandInteraction, user: IUser, data: RecentGamesData) {
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
  const embed = new EmbedBuilder()
    .setTitle('No Recent Games')
    .setDescription(userFilter ? `No recent games found for user: ${userFilter}` : 'There are no recent games in the database.')
    .setColor('#ff6b6b')
    .setTimestamp();

  return embed;
}

function createRecentGamesEmbed(user: IUser, games: any[], currentPage: number, totalPages: number, startIndex: number, endIndex: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Recent Games - ${user.ign || user.discordId}`)
    .setDescription(`Showing games ${startIndex + 1}-${endIndex} of ${user.recentGames.length}`)
    .setColor('#00AAAA')
    .setTimestamp();

  const gamesList = formatGamesList(games);
  embed.addFields({
    name: 'Games',
    value: gamesList || 'No games found',
    inline: false
  });

  if (totalPages > 1) {
    embed.setFooter({ text: `Page ${currentPage + 1} of ${totalPages}` });
  }

  return embed;
}

function formatGamesList(games: any[]): string {
  return games.map(game => {
    const stateEmoji = getStateEmoji(game.state);
    const eloText = game.eloGain >= 0 ? `+${game.eloGain}` : `${game.eloGain}`;
    return `${stateEmoji} **Game #${game.gameId}:** ${getStateText(game.state)} \`${eloText}\``;
  }).join('\n');
}

function getStateEmoji(state: string): string {
  switch (state) {
    case 'win':
    case 'scored':
      return '🟢';
    case 'lose':
    case 'loss':
      return '🔴';
    case 'voided':
      return '⚪';
    case 'pending':
    case 'active':
      return '🟡';
    default:
      return '⚫';
  }
}

function getStateText(state: string): string {
  switch (state) {
    case 'win':
    case 'scored':
      return 'Won';
    case 'lose':
    case 'loss':
      return 'Lost';
    case 'voided':
      return 'Voided';
    case 'pending':
    case 'active':
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
        .setEmoji('⬅️')
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('recentgames_next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('➡️')
        .setDisabled(currentPage === totalPages - 1)
    );

  return [row];
}

async function setupPaginationCollector(interaction: Message | ChatInputCommandInteraction, user: IUser, data: RecentGamesData, totalPages: number) {
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
      await i.reply({ content: 'An error occurred while updating the page.', ephemeral: true });
    }
  });

  collector.on('end', async () => {
    try {
      if (interaction instanceof ChatInputCommandInteraction && interaction.replied) {
        await interaction.editReply({ components: [] });
      }
    } catch (error) {
      console.error('Error cleaning up pagination:', error);
    }
  });
}