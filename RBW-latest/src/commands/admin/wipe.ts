import { Message, ChatInputCommandInteraction, User as DiscordUser } from 'discord.js';
import User from '../../models/User';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { fix } from '../../utils/fix';
import { safeReply } from '../../utils/safeReply';

export async function wipe(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetId: string | undefined;
  let targetMention: string | undefined;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetId = user.id;
    targetMention = `<@${user.id}>`;
  } else {
    if (!args || args.length !== 1) {
      await safeReply(interaction, errorEmbed('Usage: =wipe <@user>', 'Wipe Error'));
      return;
    }
    const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
    if (!mentionMatch) {
      await safeReply(interaction, errorEmbed('Please mention a valid user.', 'Wipe Error'));
      return;
    }
    targetId = mentionMatch[1];
    targetMention = args[0];
  }

  try {
    const userDoc = await User.findOne({ discordId: targetId });
    if (!userDoc) {
      await safeReply(interaction, errorEmbed('User not found in the database.', 'Wipe Error'));
      return;
    }

    
    userDoc.elo = 0;
    userDoc.wins = 0;
    userDoc.losses = 0;
    userDoc.games = 0;
    userDoc.mvps = 0;
    userDoc.kills = 0;
    userDoc.deaths = 0;
    userDoc.bedBroken = 0;
    userDoc.finalKills = 0;
    userDoc.diamonds = 0;
    userDoc.irons = 0;
    userDoc.gold = 0;
    userDoc.emeralds = 0;
    userDoc.blocksPlaced = 0;
    userDoc.winstreak = 0;
    userDoc.losestreak = 0;
    userDoc.kdr = 0;
    userDoc.wlr = 0;
    userDoc.recentGames = [];
    userDoc.dailyElo = [];

    await userDoc.save();

    
    if (interaction.guild) {
      await fix(interaction.guild, userDoc.discordId);
    }

    await safeReply(interaction, successEmbed(`All stats for ${targetMention} have been wiped.`, 'Wipe Successful'));
  } catch (error) {
    console.error('Error in wipe command:', error);
    await safeReply(interaction, errorEmbed('There was an error wiping the user stats.', 'Wipe Error'));
  }
}