import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import User from '../../models/User';
import { safeFix } from '../../utils/fix';
import { escapeRegex } from '../../utils/regexEscape';
import { parseDiscordId, isValidIgn } from '../../utils/inputValidation';



export async function forceregister(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetUser: string | null;
  let ign: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetUser = user.id;
    ign = interaction.options.getString('ign', true);
  } else {
    if (!args || args.length < 2) {
      await safeReply(interaction, errorEmbed('Usage: =forceregister <user> <ign>', 'Force Register Error'));
      return;
    }
    targetUser = parseDiscordId(args[0]);
    if (!targetUser) {
      await safeReply(interaction, errorEmbed('Please mention a valid user or ID.', 'Force Register Error'));
      return;
    }
    ign = args[1];
  }

  if (!isValidIgn(ign)) {
    await safeReply(interaction, errorEmbed('IGN must be 3-16 characters of letters, numbers or underscores.', 'Force Register Error'));
    return;
  }

  try {
    
    const ignTaken = await User.findOne({ ign: { $regex: `^${escapeRegex(ign)}$`, $options: 'i' }, discordId: { $ne: targetUser } });
    if (ignTaken) {
      await safeReply(interaction, errorEmbed('This IGN is already registered to another user.', 'Force Register Error'));
      return;
    }

    let user = await User.findOne({ discordId: targetUser });

    if (user) {
      const oldIgn = user.ign;
      user.ign = ign;
      await user.save();

      const embed = successEmbed(`Successfully updated registration for <@${targetUser}>`, '✅ User Force Registered');
      embed.builder.addFields(
        { name: 'User', value: `<@${targetUser}>`, inline: true },
        { name: 'Previous IGN', value: oldIgn || 'None', inline: true },
        { name: 'New IGN', value: ign, inline: true },
        { name: 'Moderator', value: `<@${interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id}>`, inline: true }
      );
      await safeReply(interaction, embed);
    } else {
      user = new User({
        discordId: targetUser,
        ign,
        elo: 0,
        wins: 0,
        losses: 0,
        games: 0,
        mvps: 0,
        kills: 0,
        deaths: 0,
        bedBroken: 0,
        finalKills: 0,
        isBanned: false,
        isMuted: false,
        isFrozen: false,
        settings: {
          toggleprefix: false,
          togglescoreping: false,
          togglepartyinvites: false,
          togglestaticnick: false,
        },
        recentGames: [],
        dailyElo: [],
        strikes: [],
        mutes: [],
        bans: []
      });
      await user.save();
      await safeFix(interaction.guild, targetUser);

      const embed = successEmbed(`Successfully force registered <@${targetUser}>`, '✅ User Force Registered');
      embed.builder.addFields(
        { name: 'IGN', value: ign, inline: false },
        { name: 'Moderator', value: `<@${interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id}>`, inline: false }
      );
      await safeReply(interaction, embed);
    }
  } catch (error) {
    console.error('Error in forceregister command:', error);
    await safeReply(interaction, errorEmbed('There was an error force registering the user.', 'Force Register Error'));
  }
}