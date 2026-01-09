
import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { BanManager } from '../../managers/BanManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';

export async function unban(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetId: string;
  let guild: any;
  let issuerId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    targetId = interaction.options.getString('userid', true);
    guild = interaction.guild;
    issuerId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =unban <userId>', 'Unban Usage Error'));
      return;
    }
    targetId = args[0];
    guild = (interaction as Message).guild;
    issuerId = (interaction as Message).author.id;
  }

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.'));
    return;
  }

  try {
    await BanManager.unban(guild, targetId, issuerId);
    await safeReply(interaction, successEmbed(`Unbanned <@${targetId}>.`, 'User Unbanned'));
  } catch (error) {
    await safeReply(interaction, errorEmbed('Failed to unban user.'));
  }
}