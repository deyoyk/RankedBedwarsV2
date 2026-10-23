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
      await safeReply(interaction, errorEmbed('Usage: =lose <@user>', 'Lose Usage Error'));
      return;
    }
    const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
    if (!mentionMatch) {
      await safeReply(interaction, errorEmbed('Please provide a user mention (e.g. <@1234567890>).', 'Lose Usage Error'));
      return;
    }
    targetId = mentionMatch[1];
  }

  try {
    const existing = await User.findOne({ discordId: targetId });
    if (!existing) {
      await safeReply(interaction, errorEmbed('User not found.'));
      return;
    }

    const eloRank = await EloRank.findOne({
      startElo: { $lte: existing.elo },
      endElo: { $gte: existing.elo },
    });
    if (!eloRank) {
      await safeReply(interaction, errorEmbed('Elo rank not found.'));
      return;
    }

    ensureUserStats(existing);

    const newElo = Math.max(0, existing.elo - eloRank.loseElo);
    const newLosestreak = (existing.losestreak ?? 0) + 1;
    const newWlr = computeWlr(existing.wins, existing.losses + 1);
    const user = await User.findOneAndUpdate(
      { discordId: targetId },
      {
        $set: { elo: newElo, losestreak: newLosestreak, winstreak: 0, wlr: newWlr },
        $inc: { losses: 1, games: 1 },
      },
      { new: true }
    );
    if (!user) {
      await safeReply(interaction, errorEmbed('User not found.'));
      return;
    }
    updateDailyElo(user, user.elo);
    await user.save();

    if (interaction.guild) {
      await fix(interaction.guild, user.discordId);
    }

    await safeReply(interaction, successEmbed(`Gave loss to <@${targetId}> (-${eloRank.loseElo} Elo).`, 'Loss Given'));
  } catch {
    await safeReply(interaction, errorEmbed('Failed to give loss.'));
  }
}
