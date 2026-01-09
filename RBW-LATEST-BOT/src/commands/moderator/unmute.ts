
import { Message, ChatInputCommandInteraction } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { MuteManager } from '../../managers/MuteManager';
import { errorEmbed, successEmbed } from '../../utils/betterembed';

export async function unmute(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetId: string;
  let guild: any;
  let issuerId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    targetId = interaction.options.getString('userid', true);
    guild = interaction.guild;
    issuerId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =unmute <userId>', 'Unmute Usage Error'));
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
    await MuteManager.unmute(guild, targetId, issuerId);
    await safeReply(interaction, successEmbed(`Unmuted <@${targetId}>.`, 'User Unmuted'));
  } catch (error) {
    await safeReply(interaction, errorEmbed('Failed to unmute user.'));
  }
}