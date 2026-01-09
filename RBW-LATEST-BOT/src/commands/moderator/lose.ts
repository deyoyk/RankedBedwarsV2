import { Message, ChatInputCommandInteraction, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import EloRank from '../../models/EloRank';
import { fix } from '../../utils/fix';

export async function lose(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user');
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found.'));
      return;
    }
    targetId = user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =lose <userId>', 'Lose Usage Error'));
      return;
    }
    targetId = args[0];
  }

  try {
    const user = await User.findOne({ discordId: targetId });
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found.'));
      return;
    }

    const eloRank = await EloRank.findOne({
      startElo: { $lte: user.elo },
      endElo: { $gte: user.elo },
    });
    if (!eloRank) {
      await safeReply(interaction, errorEmbed('Elo rank not found.'));
      return;
    }

    user.elo = Math.max(0, user.elo - eloRank.loseElo);
    user.losses += 1;
    user.games += 1;
    user.losestreak = (user.losestreak ?? 0) + 1;
    user.winstreak = 0;
    const wins = user.wins ?? 0;
    const losses = user.losses ?? 0;
    user.wlr = losses > 0 ? parseFloat((wins / losses).toFixed(2)) : wins;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const existingEntry = user.dailyElo.find(entry => {
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

    await safeReply(interaction, successEmbed(`Gave loss to <@${targetId}> (-${eloRank.loseElo} Elo).`, 'Loss Given'));
  } catch (err) {
    await safeReply(interaction, errorEmbed('Failed to give loss.'));
  }
}