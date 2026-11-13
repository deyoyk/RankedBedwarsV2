import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Message, ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import User from '../../models/User';
import { embedsFor } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { generateLeaderboardImage, LeaderboardEntry } from '../../utils/leaderboardImage';

const { errorEmbed } = embedsFor('Leaderboard');

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
  winStreak: { title: 'Winstreak Leaderboard', field: 'winStreak' },
  loseStreak: { title: 'Losestreak Leaderboard', field: 'loseStreak' },
  kdr: { title: 'KDR Leaderboard', field: 'kdr' },
  wlr: { title: 'WLR Leaderboard', field: 'wlr' },
  damageDealt: { title: 'Damage Dealt Leaderboard', field: 'damageDealt' },
  damageTaken: { title: 'Damage Taken Leaderboard', field: 'damageTaken' },
  assists: { title: 'Assists Leaderboard', field: 'assists' },
  bestStreak: { title: 'Best Streak Leaderboard', field: 'bestStreak' },
  firstBloods: { title: 'First Bloods Leaderboard', field: 'firstBloods' },
};

const VALUE_LABELS: Record<string, string> = {
  bedBroken: 'BEDS', finalKills: 'FINALS', diamonds: 'DIAS', emeralds: 'EMS', blocksPlaced: 'BLOCKS',
  winStreak: 'STREAK', loseStreak: 'STREAK', damageDealt: 'DMG', damageTaken: 'TAKEN', bestStreak: 'BEST', firstBloods: 'FB',
};

function getModeConfig(mode: string) {
  return LEADERBOARD_MODES[mode] || LEADERBOARD_MODES.elo;
}

const labelFor = (field: string) => VALUE_LABELS[field] ?? field.toUpperCase().slice(0, 8);

function displayValue(raw: unknown): string | number {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : raw.toFixed(2);
  return typeof raw === 'string' ? raw : 0;
}

const totalCache = new Map<string, { at: number; total: number }>();
const TOTAL_CACHE_TTL_MS = 60000;

async function getCachedTotal(valueField: string): Promise<number> {
  const now = Date.now();
  const hit = totalCache.get(valueField);
  if (hit && now - hit.at < TOTAL_CACHE_TTL_MS) return hit.total;
  const total = await User.countDocuments({ [valueField]: { $ne: null } });
  if (totalCache.size >= 100) {
    const oldest = totalCache.keys().next();
    if (!oldest.done) totalCache.delete(oldest.value);
  }
  totalCache.set(valueField, { at: now, total });
  return total;
}

export async function leaderboard(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  let page = 0;
  let mode = 'elo';
  const usersPerPage = 10;
  let searchIGN: string | null = null;
  let searchPosition: number | null = null;

  mode = interaction.options.getString('mode') || 'elo';
  page = Math.max((interaction.options.getInteger('page') || 1) - 1, 0);

  async function renderPage(page: number) {
    const { title, field: valueField } = getModeConfig(mode);

    if (searchIGN) {
      const user = await User.findOne({ ign: searchIGN }).select(`${valueField} ign`).lean();
      if (!user) {
        const embedObj = errorEmbed(`IGN not found: ${searchIGN}`, 'IGN Not Found');
        await replyEmbed(embedObj);
        return;
      }
      const ahead = await User.countDocuments({ [valueField]: { $gt: (user as Record<string, unknown>)[valueField] } });
      page = Math.floor(ahead / usersPerPage);
    }

    if (searchPosition !== null) {
      page = Math.floor((searchPosition - 1) / usersPerPage);
    }

    const users = await User.find({ [valueField]: { $ne: null } })
      .sort({ [valueField]: -1 })
      .skip(page * usersPerPage)
      .limit(usersPerPage)
      .select(`ign discordId elo ${valueField}`)
      .lean();
    const totalUsers = await getCachedTotal(valueField);

    if (!users || users.length === 0) {
      
      const embedObj = errorEmbed('No users found for this leaderboard.', title ?? undefined);
      await safeReply(interaction, { embeds: [embedObj.builder] });
      return;
    }

    const entries: LeaderboardEntry[] = users.map((user, i) => ({
      rank: page * usersPerPage + i + 1,
      ign: user.ign || user.discordId,
      value: displayValue((user as Record<string, unknown>)[valueField]),
      elo: user.elo,
    }));
    const totalPages = Math.max(1, Math.ceil(totalUsers / usersPerPage));
    const image = await generateLeaderboardImage(title, labelFor(valueField), entries, page, totalPages);

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (totalUsers > usersPerPage) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('prev_page').setLabel('⬅️').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('next_page').setLabel('➡️').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
        new ButtonBuilder().setCustomId('search_ign').setLabel('🔍').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('search_pos').setLabel('#').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('reload').setLabel('🔃').setStyle(ButtonStyle.Success),
      ));
    }
    await send({ files: [new AttachmentBuilder(image, { name: 'leaderboard.png' })], embeds: [], components });
  }

  let replyMsg: Message | undefined;

  async function send(payload: { embeds: ReturnType<typeof errorEmbed>['builder'][]; files?: AttachmentBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }) {
      if (replyMsg) {
        await safeReply(interaction, payload).catch(() => {});
        return;
      }
      const msg = await safeReply(interaction, { ...payload, fetchReply: true });
      replyMsg = msg as unknown as Message | undefined;
  }

  async function replyEmbed(embedObj: ReturnType<typeof errorEmbed>) {
    await send({ embeds: [embedObj.builder], files: [], components: [] });
  }

  await renderPage(page);

  const scope = replyMsg ?? interaction.channel;
  const collector = scope?.createMessageComponentCollector({ time: 120000 });

  collector?.on('collect', async i => {
    
    const authorId = interaction.user.id;
    if (i.user.id !== authorId) {
      await i.reply(errorEmbed('You cannot interact with this leaderboard.', 'Leaderboard Error', true)); 
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
        
        const user = await User.findOne({ ign: searchIGN }).select('ign').lean();
        if (user) {
          const { field: valueField } = getModeConfig(mode);
          const userValue = (user as unknown as Record<string, unknown>)[valueField];
          const ahead = await User.countDocuments({ [valueField]: { $gt: userValue } });
          page = Math.floor(ahead / usersPerPage);
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
    if (interaction.replied) {
      await interaction.editReply({ components: [] });
    }
  });
}