import { Message, ChatInputCommandInteraction } from 'discord.js';
import { errorEmbed, successEmbed, betterEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import EloRank from '../../models/EloRank';
import { fix } from '../../utils/fix';
import { ensureUserStats, updateDailyElo, computeWlr } from '../../utils/userStats';

export async function win(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUserId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const optionUser = interaction.options.getUser('user');
    targetUserId = optionUser ? optionUser.id : interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      targetUserId = interaction.author.id;
    } else {
      const mentionMatch = args[0].match(/^<@!?([0-9]+)>$/);
      if (!mentionMatch) {
        await safeReply(interaction, errorEmbed('Please provide a user mention (e.g. <@1234567890>).', 'Win Usage Error'));
        return;
      }
      targetUserId = mentionMatch[1];
    }
  }

  try {
    const existing = await User.findOne({ discordId: targetUserId });
    if (!existing) {
      await safeReply(interaction, errorEmbed('User not found or not registered.', 'Win Usage Error'));
      return;
    }

    ensureUserStats(existing);

    const eloRank = await EloRank.findOne({
      startElo: { $lte: existing.elo },
      endElo: { $gte: existing.elo },
    });
    if (!eloRank) {
      await safeReply(interaction, errorEmbed('Elo rank not found.', 'Win Usage Error'));
      return;
    }

    const newWinStreak = (existing.winStreak ?? 0) + 1;
    const newWlr = computeWlr(existing.wins + 1, existing.losses);
    const user = await User.findOneAndUpdate(
      { discordId: targetUserId },
      {
        $inc: { elo: eloRank.winElo, wins: 1, games: 1 },
        $set: { winStreak: newWinStreak, loseStreak: 0, wlr: newWlr },
      },
      { new: true }
    );
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found or not registered.', 'Win Usage Error'));
      return;
    }
    updateDailyElo(user, user.elo);
    await user.save();

    if (interaction.guild) {
      await fix(interaction.guild, user.discordId);
    }

    try {
      await safeReply(interaction, successEmbed(`Gave win to <@${targetUserId}> (+${eloRank.winElo} Elo).`, 'Win Given'));
    } catch {
      const fallbackEmbed = betterEmbed(`Gave win to <@${targetUserId}> (+${eloRank.winElo} Elo).`, 0x00ff00, 'Win Given');
      await safeReply(interaction, { embeds: [fallbackEmbed.builder] });
    }
  } catch {
    try {
      await safeReply(interaction, errorEmbed('Failed to give win.', 'Win Usage Error'));
    } catch {
      const fallbackEmbed = betterEmbed('Failed to give win.', 0xff0000, 'Win Usage Error');
      await safeReply(interaction, { embeds: [fallbackEmbed.builder] });
    }
  }
}
