import { Message, ChatInputCommandInteraction } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { StrikeManager } from '../../managers/StrikeManager';

export async function unstrike(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  let targetId: string;
  let reason: string;
  let guild: any;
  let issuerId: string;

  if (interaction instanceof ChatInputCommandInteraction) {
    const user = interaction.options.getUser('user', true);
    targetId = user.id;
    reason = interaction.options.getString('reason', false) || 'No reason provided';
    guild = interaction.guild;
    issuerId = interaction.user.id;
  } else {
    if (!args || args.length < 1) {
      await safeReply(interaction, errorEmbed('Usage: =unstrike <userId> [reason]', 'Unstrike Usage Error'));
      return;
    }
    targetId = args[0];
    reason = args.slice(1).join(' ') || 'No reason provided';
    guild = (interaction as Message).guild;
    issuerId = (interaction as Message).author.id;
  }

  if (!guild) {
    await safeReply(interaction, errorEmbed('This command can only be used in a server.'));
    return;
  }

  try {
    await StrikeManager.unstrike(guild, targetId, issuerId, reason);
    const embed = successEmbed(
      `Strike removed from <@${targetId}>.\n**Reason:** ${reason}`,
      undefined,
      false
    );
    await safeReply(interaction, embed);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove strike.';
    await safeReply(interaction, errorEmbed(errorMessage, 'Unstrike Error'));
  }
}