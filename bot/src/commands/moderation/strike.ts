import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { StrikeManager } from '../../managers/StrikeManager';
import { executeStrikeAction } from '../../utils/modCommands';

export async function strike(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  await executeStrikeAction(interaction, {
    commandName: 'strike',
    successMessage: (targetId, reason) => `Strike issued to <@${targetId}>.\n**Reason:** ${reason}`,
    managerCall: (guild, targetId, issuerId, reason) => StrikeManager.strike(guild, targetId, issuerId, reason)
  });
}
