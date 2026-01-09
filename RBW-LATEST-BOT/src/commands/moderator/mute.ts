
import { Message, ChatInputCommandInteraction, Guild } from 'discord.js';
import { safeReply } from '../../utils/safeReply';
import { MuteManager } from '../../managers/MuteManager';
import { successEmbed, errorEmbed } from '../../utils/betterembed';

 


export async function mute(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetId: string;
  let duration: string = '';
  let reason: string = 'No reason provided';
  let guild: Guild | null = null;
  let issuerId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetId = user.id;
    duration = interaction.options.getString('duration', false) || '';
    reason = interaction.options.getString('reason', false) || 'No reason provided';
    guild = interaction.guild;
    issuerId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =mute <@user> [duration] [reason]', 'Mute Usage Error'));
      return;
    }
    const mentionMatch = args[0].match(/^<@!?(\d+)>$/);
    if (!mentionMatch) {
      await safeReply(interaction, errorEmbed('Please mention a valid user.', 'Mute Usage Error'));
      return;
    }
    targetId = mentionMatch[1];
    duration = args[1] || '';
    reason = args.length > 2 ? args.slice(2).join(' ') : 'No reason provided';
    guild = interaction.guild;
    issuerId = interaction.author.id;
  }

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.', 'Mute Error'));
    return;
  }

  try {
    await MuteManager.mute(guild, targetId, issuerId, duration, reason);
    const embed = successEmbed(
      `Muted <@${targetId}>.${duration ? `\n**Duration:** ${duration}` : ''}\n**Reason:** ${reason}`,
      undefined,
      false
    );
    await safeReply(interaction, embed);
  } catch (error) {
    await safeReply(interaction, errorEmbed('Failed to mute user.', 'Mute Error'));
  }
}