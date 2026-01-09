import { Message, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { betterEmbed, errorEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import Game from '../../models/Game';
import User from '../../models/User';

 


export async function games(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let page = 1;
  const gamesPerPage = 15;

  if (interaction instanceof ChatInputCommandInteraction) {
    page = interaction.options.getInteger('page') || 1;
  } else if (args && args.length > 0) {
    const parsedPage = parseInt(args[0]);
    if (!isNaN(parsedPage)) {
      page = parsedPage;
    }
  }

  try {
    const totalGames = await Game.countDocuments();
    const totalPages = Math.ceil(totalGames / gamesPerPage);
    
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    
    const skip = (page - 1) * gamesPerPage;

    const games = await Game.find()
      .sort({ gameId: -1 })
      .skip(skip)
      .limit(gamesPerPage);

    if (games.length === 0) {
      await safeReply(interaction, errorEmbed('There are no games in the database.', 'No Games Found'));
      return;
    }

    const embed = await createGamesEmbed(games, page, totalPages, totalGames, skip);
    
    
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`games_first_${page}`)
          .setLabel('First')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`games_prev_${page}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 1),
        new ButtonBuilder()
          .setCustomId(`games_next_${page}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages),
        new ButtonBuilder()
          .setCustomId(`games_last_${page}`)
          .setLabel('Last')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages)
      );

    const response = await safeReply(interaction, { 
      embeds: [embed.builder], 
      components: totalPages > 1 ? [row] : [] 
    });

    
    if (totalPages > 1) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000 
      });

      collector.on('collect', async (buttonInteraction) => {
        if (buttonInteraction.user.id !== (interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id)) {
          await buttonInteraction.reply({ content: 'You can only use your own pagination buttons!', ephemeral: true });
          return;
        }

        let newPage = page;
        if (buttonInteraction.customId.startsWith('games_first_')) {
          newPage = 1;
        } else if (buttonInteraction.customId.startsWith('games_prev_')) {
          newPage = page - 1;
        } else if (buttonInteraction.customId.startsWith('games_next_')) {
          newPage = page + 1;
        } else if (buttonInteraction.customId.startsWith('games_last_')) {
          newPage = totalPages;
        }

        const newSkip = (newPage - 1) * gamesPerPage;
        const newGames = await Game.find()
          .sort({ gameId: -1 })
          .skip(newSkip)
          .limit(gamesPerPage);

        const newEmbed = await createGamesEmbed(newGames, newPage, totalPages, totalGames, newSkip);
        
        const newRow = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`games_first_${newPage}`)
              .setLabel('First')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === 1),
            new ButtonBuilder()
              .setCustomId(`games_prev_${newPage}`)
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === 1),
            new ButtonBuilder()
              .setCustomId(`games_next_${newPage}`)
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === totalPages),
            new ButtonBuilder()
              .setCustomId(`games_last_${newPage}`)
              .setLabel('Last')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(newPage === totalPages)
          );

        await buttonInteraction.update({ embeds: [newEmbed.builder], components: [newRow] });
        page = newPage;
      });

      collector.on('end', async () => {
        
        const disabledRow = new ActionRowBuilder<ButtonBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('games_first_disabled')
              .setLabel('First')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('games_prev_disabled')
              .setLabel('Previous')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('games_next_disabled')
              .setLabel('Next')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId('games_last_disabled')
              .setLabel('Last')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true)
          );

        try {
          await response.edit({ components: [disabledRow] });
        } catch (error) {
          
        }
      });
    }

  } catch (error) {
    console.error('Error in games command:', error);
    
    await interaction.reply(errorEmbed('There was an error fetching the games.', 'Error'));
  }
}

async function createGamesEmbed(games: any[], page: number, totalPages: number, totalGames: number, skip: number) {
  const embed = betterEmbed(
    `Showing games ${skip + 1}-${skip + games.length} of ${totalGames}`,
    '#00AAAA',
    'Game History'
  );

  let gamesList = games.map(game => {
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

  return embed;
}