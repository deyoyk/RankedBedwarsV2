import { Message, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import EloRank from '../../models/EloRank';
import { fix } from '../../utils/fix';

export async function win(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUserId: string;
  let user: any;

  if (interaction instanceof ChatInputCommandInteraction) {
    
    const optionUser = interaction.options.getUser('user');
    if (optionUser) {
      targetUserId = optionUser.id;
    } else {
      targetUserId = interaction.user.id;
    }
  } else {
    
    if (!args || args.length < 1) {
      targetUserId = interaction.author.id;
    } else {
      const arg = args[0];
      const mentionMatch = arg.match(/^<@!?([0-9]+)>$/);
      if (mentionMatch) {
        targetUserId = mentionMatch[1];
      } else {
        await safeReply(interaction, errorEmbed('Please provide a user mention (e.g. <@1234567890>).', 'Win Usage Error'));
        return;
      }
    }
  }

  try {
    if (!user) {
      user = await User.findOne({ discordId: targetUserId });
    }
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found or not registered.', 'Win Usage Error'));
      return;
    }
    targetUserId = user.discordId;

    
    user.elo = typeof user.elo === 'number' && !isNaN(user.elo) ? user.elo : 0;
    user.wins = typeof user.wins === 'number' && !isNaN(user.wins) ? user.wins : 0;
    user.games = typeof user.games === 'number' && !isNaN(user.games) ? user.games : 0;
    user.winstreak = typeof user.winstreak === 'number' && !isNaN(user.winstreak) ? user.winstreak : 0;
    user.losestreak = typeof user.losestreak === 'number' && !isNaN(user.losestreak) ? user.losestreak : 0;
    user.losses = typeof user.losses === 'number' && !isNaN(user.losses) ? user.losses : 0;
    
    if (!Array.isArray(user.dailyElo)) user.dailyElo = [];

    const eloRank = await EloRank.findOne({
      startElo: { $lte: user.elo },
      endElo: { $gte: user.elo },
    });
    if (!eloRank) {
      await safeReply(interaction, errorEmbed('Elo rank not found.', 'Win Usage Error'));
      return;
    }

    user.elo += eloRank.winElo;
    user.wins += 1;
    user.games += 1;
    user.winstreak = (user.winstreak ?? 0) + 1;
    user.losestreak = 0;
    const wins = user.wins ?? 0;
    const losses = user.losses ?? 0;
    user.wlr = losses > 0 ? parseFloat((wins / losses).toFixed(2)) : wins;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existingEntry = user.dailyElo.find((entry: any) => {
      const entryDate = new Date(entry.date);
      entryDate.setHours(0, 0, 0, 0);
      return entryDate.getTime() === today.getTime();
    });
    if (existingEntry) {
      existingEntry.elo = user.elo;
    } else {
      user.dailyElo.push({ elo: user.elo, date: new Date() });
    }

    await user.save();

    if (interaction.guild) {
      await fix(interaction.guild, user.discordId);
    }

    try {
      await safeReply(interaction, successEmbed(`Gave win to <@${targetUserId}> (+${eloRank.winElo} Elo).`, 'Win Given'));
    } catch (e) {
      const fallbackEmbed = betterEmbed(`Gave win to <@${targetUserId}> (+${eloRank.winElo} Elo).`, 0x00ff00, 'Win Given');
      await safeReply(interaction, { embeds: [fallbackEmbed.builder] });
    }
  } catch (err) {
    try {
      await safeReply(interaction, errorEmbed('Failed to give win.', 'Win Usage Error'));
    } catch {
      const fallbackEmbed = betterEmbed('Failed to give win.', 0xff0000, 'Win Usage Error');
      await safeReply(interaction, { embeds: [fallbackEmbed.builder] });
    }
  }
}