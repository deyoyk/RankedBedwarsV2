import { Message, ChatInputCommandInteraction } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import User from '../../models/User';
import EloRank from '../../models/EloRank';
import { fix } from '../../utils/fix';
import { ensureUserStats, updateDailyElo, computeWlr } from '../../utils/userStats';

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

    ensureUserStats(user);

    user.elo = Math.max(0, user.elo - eloRank.loseElo);
    user.losses += 1;
    user.games += 1;
    user.losestreak = (user.losestreak ?? 0) + 1;
    user.winstreak = 0;
    user.wlr = computeWlr(user.wins, user.losses);
    updateDailyElo(user, user.elo);

    await user.save();

    if (interaction.guild) {
      await fix(interaction.guild, user.discordId);
    }

    await safeReply(interaction, successEmbed(`Gave loss to <@${targetId}> (-${eloRank.loseElo} Elo).`, 'Loss Given'));
  } catch (err) {
    await safeReply(interaction, errorEmbed('Failed to give loss.'));
  }
}
