
import { Message, ChatInputCommandInteraction } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/betterembed';
import { safeReply } from '../../utils/safeReply';
import { StrikeManager } from '../../managers/StrikeManager';

export async function strike(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
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
      await safeReply(interaction, errorEmbed('Usage: =strike <userId> [reason]', 'Strike Usage Error'));
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
    await StrikeManager.strike(guild, targetId, issuerId, reason);
    const embed = successEmbed(
      `Strike issued to <@${targetId}>.\n**Reason:** ${reason}`,
      undefined,
      false
    );
    await safeReply(interaction, embed);
  } catch (error) {
    await safeReply(interaction, errorEmbed('Failed to issue strike.'));
  }
}