import { Message, ChatInputCommandInteraction } from 'discord.js';
import { StrikeManager } from '../../managers/StrikeManager';
import { executeStrikeAction } from '../../utils/modCommands';

export async function unstrike(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  await executeStrikeAction(interaction, args, {
    commandName: 'unstrike',
    successMessage: (targetId, reason) => `Strike removed from <@${targetId}>.\n**Reason:** ${reason}`,
    managerCall: (guild, targetId, issuerId, reason) => StrikeManager.unstrike(guild, targetId, issuerId, reason)
  });
}
