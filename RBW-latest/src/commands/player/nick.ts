import { Message, ChatInputCommandInteraction } from 'discord.js';
import UserModel from '../../models/User';
import { fix } from '../../utils/fix';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';

export async function nick(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  const userId = interaction instanceof ChatInputCommandInteraction ? interaction.user.id : interaction.author.id;
  const user = await UserModel.findOne({ discordId: userId });
  
  if (!user) {
    await safeReply(interaction, errorEmbed('You need to register first!', 'Nickname Error'));
    return;
  }

  if (!args || args.length === 0 || (args[0].toLowerCase() === 'set' && args.length === 1)) {
    await safeReply(interaction, errorEmbed('Usage: =nick <set/remove> [nickname]', 'Nickname Error'));
    return;
  }

  const action = args[0].toLowerCase();
  if (action === 'set') {
    const nickname = args.slice(1).join(' ').trim();
    if (!nickname) {
      await safeReply(interaction, errorEmbed('Please provide a nickname to set.', 'Nickname Error'));
      return;
    }
    user.nick = nickname;
    await user.save();
    if (interaction.guild) {
      await fix(interaction.guild, userId);
    }
    await safeReply(interaction, successEmbed(`Your nickname has been set to: **${nickname}**`, 'Nickname Set'));
  } else if (action === 'remove') {
    if (!user.nick) {
      await safeReply(interaction, errorEmbed('You do not have a nickname set.', 'Nickname Error'));
      return;
    }
    user.nick = undefined;
    await user.save();
    if (interaction.guild) {
      await fix(interaction.guild, userId);
    }
    await safeReply(interaction, successEmbed('Your nickname has been removed.', 'Nickname Removed'));
  } else {
    await safeReply(interaction, errorEmbed('Invalid action! Use: set or remove', 'Nickname Error'));
  }
}