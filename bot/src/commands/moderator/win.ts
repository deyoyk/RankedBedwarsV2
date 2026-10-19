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
    const user = await User.findOne({ discordId: targetUserId });
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found or not registered.', 'Win Usage Error'));
      return;
    }

    ensureUserStats(user);

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
    user.wlr = computeWlr(user.wins, user.losses);
    updateDailyElo(user, user.elo);

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
