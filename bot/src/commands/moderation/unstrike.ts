import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { StrikeManager } from '../../managers/StrikeManager';
import { executeStrikeAction } from '../../utils/modCommands';

export async function unstrike(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  await executeStrikeAction(interaction, {
    commandName: 'unstrike',
    successMessage: (targetId, reason) => `Strike removed from <@${targetId}>.\n**Reason:** ${reason}`,
    managerCall: (guild, targetId, issuerId, reason) => StrikeManager.unstrike(guild, targetId, issuerId, reason)
  });
}
