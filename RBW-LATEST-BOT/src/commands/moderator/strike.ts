import { Message, ChatInputCommandInteraction } from 'discord.js';
import { StrikeManager } from '../../managers/StrikeManager';
import { executeStrikeAction } from '../../utils/modCommands';

export async function strike(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  await executeStrikeAction(interaction, args, {
    commandName: 'strike',
    successMessage: (targetId, reason) => `Strike issued to <@${targetId}>.\n**Reason:** ${reason}`,
    managerCall: (guild, targetId, issuerId, reason) => StrikeManager.strike(guild, targetId, issuerId, reason)
  });
}
