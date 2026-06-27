import { Message, ChatInputCommandInteraction } from 'discord.js';
import { BanManager } from '../../managers/BanManager';
import { executeModerationAction } from '../../utils/modCommands';

export async function ban(interaction: Message | ChatInputCommandInteraction, args?: string[]) {
  await executeModerationAction(interaction, args, {
    commandName: 'ban',
    actionVerb: 'Banned',
    managerCall: (guild, targetId, issuerId, duration, reason) => BanManager.ban(guild, targetId, issuerId, duration, reason),
    hasDuration: true
  });
}
