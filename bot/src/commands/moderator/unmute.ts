import { Message, ChatInputCommandInteraction } from 'discord.js';
import { MuteManager } from '../../managers/MuteManager';
import { executeUnmoderationAction } from '../../utils/modCommands';

export async function unmute(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  await executeUnmoderationAction(interaction, args, {
    commandName: 'unmute',
    actionVerb: 'Unmuted',
    managerCall: (guild, targetId, issuerId) => MuteManager.unmute(guild, targetId, issuerId)
  });
}
