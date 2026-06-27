import { Message, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionCollector, ModalSubmitInteraction } from 'discord.js';
import User, { IUser } from '../../models/User';
import { betterEmbed, errorEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

const LEADERBOARD_MODES: Record<string, { title: string; field: string }> = {
  elo: { title: 'Elo Leaderboard', field: 'elo' },
  wins: { title: 'Wins Leaderboard', field: 'wins' },
  losses: { title: 'Losses Leaderboard', field: 'losses' },
  games: { title: 'Games Played Leaderboard', field: 'games' },
  mvps: { title: 'MVPs Leaderboard', field: 'mvps' },
  kills: { title: 'Kills Leaderboard', field: 'kills' },
  deaths: { title: 'Deaths Leaderboard', field: 'deaths' },
  bedBroken: { title: 'Beds Broken Leaderboard', field: 'bedBroken' },
  finalKills: { title: 'Final Kills Leaderboard', field: 'finalKills' },
  diamonds: { title: 'Diamonds Collected Leaderboard', field: 'diamonds' },
  irons: { title: 'Irons Collected Leaderboard', field: 'irons' },
  gold: { title: 'Gold Collected Leaderboard', field: 'gold' },
  emeralds: { title: 'Emeralds Collected Leaderboard', field: 'emeralds' },
  blocksPlaced: { title: 'Blocks Placed Leaderboard', field: 'blocksPlaced' },
  winstreak: { title: 'Winstreak Leaderboard', field: 'winstreak' },
  losestreak: { title: 'Losestreak Leaderboard', field: 'losestreak' },
  kdr: { title: 'KDR Leaderboard', field: 'kdr' },
  wlr: { title: 'WLR Leaderboard', field: 'wlr' },
};

function getModeConfig(mode: string) {
  return LEADERBOARD_MODES[mode] || LEADERBOARD_MODES.elo;
}

export async function leaderboard(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let page = 0;
  let mode = 'elo';
  const usersPerPage = 10;
  let searchIGN: string | null = null;
  let searchPosition: number | null = null;

  if (interaction instanceof ChatInputCommandInteraction) {
    mode = interaction.options.getString('mode') || 'elo';
    page = interaction.options.getInteger('page') || 0;
  } else if (args && args.length > 0) {
    mode = args[0] || 'elo';
    if (args[1]) {
      const parsedPage = parseInt(args[1]);
      if (!isNaN(parsedPage)) page = parsedPage - 1;
    }
  }

  async function renderPage(page: number) {
    let users: IUser[] = [];
    let totalUsers = 0;
    const { title, field: valueField } = getModeConfig(mode);

    // searching for a player by IGN? we got you fam
    if (searchIGN) {
      const user = await User.findOne({ ign: searchIGN });
      if (!user) {
        const embedObj = errorEmbed(`IGN not found: ${searchIGN}`, 'IGN Not Found');
        await replyEmbed(embedObj);
        return;
      }
      // now we gotta find where this player ranks (the grind is real)
      const allUsers = await User.find({}).sort({ [valueField]: -1 });
      const pos = allUsers.findIndex(u => u.ign === searchIGN);
      if (pos === -1) {
        const embedObj = errorEmbed(`IGN not found in leaderboard: ${searchIGN}`, 'IGN Not Found');
        await replyEmbed(embedObj);
        return;
      }
      // calculate which page this absolute legend is on
      page = Math.floor(pos / usersPerPage);
    }

    // jumping to a specific position? bet, let's calculate the page
    if (searchPosition !== null) {
      page = Math.floor((searchPosition - 1) / usersPerPage);
    }

    users = await User.find({ [valueField]: { $ne: null } })
      .sort({ [valueField]: -1 })
      .skip(page * usersPerPage)
      .limit(usersPerPage);
    totalUsers = await User.countDocuments({ [valueField]: { $ne: null } });

    if (!users || users.length === 0) {
      
      const embedObj = errorEmbed('No users found for this leaderboard.', title ?? undefined);
      await safeReply(interaction, { embeds: [embedObj.builder] });
      return;
    }

    let leaderboardList = '';
    const medals = [':first_place:', ':second_place:', ':third_place:'];
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const rank = page * usersPerPage + i + 1;
      const prefix = rank <= 3 ? medals[rank - 1] : `#${rank}`;
      const value = (user as any)[valueField] ?? 0;
      leaderboardList += `${prefix} ${user.ign || user.discordId} » ${value}\n`;
    }

    const embedObj = betterEmbed(
      `Showing positions ${page * usersPerPage + 1}-${Math.min((page + 1) * usersPerPage, totalUsers)} of ${totalUsers}`,
      0xFFD700,
      title
    );
    embedObj.builder.addFields({
      name: 'Leaderboard',
      value: leaderboardList || 'No users found',
      inline: false
    });

    
    if (totalUsers > usersPerPage) {
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('⬅️')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('➡️')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('search_ign')
            .setLabel('🔍')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('search_pos')
            .setLabel('#')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('reload')
            .setLabel('🔃')
            .setStyle(ButtonStyle.Success)
        );
      await replyEmbed(embedObj, [row]);
    } else {
      await replyEmbed(embedObj);
    }
  }

  async function replyEmbed(embedObj: any, components?: any) {
    if (interaction instanceof ChatInputCommandInteraction || interaction instanceof Message) {
      await safeReply(interaction, { embeds: [embedObj.builder], components: components || [] });
    }
  }

  await renderPage(page);

  const collector = interaction.channel?.createMessageComponentCollector({ time: 120000 });

  collector?.on('collect', async i => {
    
    let authorId: string | undefined = undefined;
    if (interaction instanceof ChatInputCommandInteraction) {
      authorId = interaction.user.id;
    } else if ('author' in interaction && interaction.author) {
      authorId = interaction.author.id;
    }
    if (i.user.id !== authorId) {
      await i.reply({ content: 'You cannot interact with this leaderboard.', flags: 64 }); 
      return;
    }
    let needsUpdate = false;
    if (i.customId === 'prev_page' && page > 0) {
      page--;
      searchIGN = null;
      searchPosition = null;
      needsUpdate = true;
    } else if (i.customId === 'next_page') {
      page++;
      searchIGN = null;
      searchPosition = null;
      needsUpdate = true;
    } else if (i.customId === 'reload') {
      searchIGN = null;
      searchPosition = null;
      needsUpdate = true;
    } else if (i.customId === 'search_ign') {
      const modal = new ModalBuilder()
        .setCustomId('search_ign_modal')
        .setTitle('Search by IGN')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('ign_input')
              .setLabel('Enter IGN')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      await i.showModal(modal);
      const filter = (m: ModalSubmitInteraction) => m.customId === 'search_ign_modal' && m.user.id === i.user.id;
      try {
        const modalInt = await i.awaitModalSubmit({ filter, time: 30000 });
        searchIGN = modalInt.fields.getTextInputValue('ign_input');
        searchPosition = null;
        
        const user = await User.findOne({ ign: searchIGN });
        if (user) {
          const { field: valueField } = getModeConfig(mode);
          const allUsers = await User.find({}).sort({ [valueField]: -1 });
          const pos = allUsers.findIndex(u => u.ign === searchIGN);
          if (pos !== -1) {
            page = Math.floor(pos / usersPerPage);
          }
        }
        needsUpdate = true;
        await modalInt.deferUpdate();
      } catch {
        
      }
    } else if (i.customId === 'search_pos') {
      const modal = new ModalBuilder()
        .setCustomId('search_pos_modal')
        .setTitle('Search by Position')
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('pos_input')
              .setLabel('Enter Position (number)')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      await i.showModal(modal);
      const filter = (m: ModalSubmitInteraction) => m.customId === 'search_pos_modal' && m.user.id === i.user.id;
      try {
        const modalInt = await i.awaitModalSubmit({ filter, time: 30000 });
        const pos = parseInt(modalInt.fields.getTextInputValue('pos_input'));
        if (!isNaN(pos) && pos > 0) {
          searchPosition = pos;
          searchIGN = null;
          
          page = Math.floor((pos - 1) / usersPerPage);
          needsUpdate = true;
        }
        await modalInt.deferUpdate();
      } catch {
        
      }
    }
    if (needsUpdate) {
      if (!i.deferred && !i.replied) {
        await i.deferUpdate();
      }
      await renderPage(page);
    }
  });

  collector?.on('end', async () => {
    if (interaction instanceof ChatInputCommandInteraction && interaction.replied) {
      await interaction.editReply({ components: [] });
    }
  });
}