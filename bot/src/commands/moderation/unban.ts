import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { BanManager } from '../../managers/BanManager';
import { executeUnmoderationAction } from '../../utils/modCommands';

export async function unban(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  await executeUnmoderationAction(interaction, {
    commandName: 'unban',
    actionVerb: 'Unbanned',
    activeWord: 'banned',
    managerCall: (guild, targetId, issuerId, reason) => BanManager.unban(guild, targetId, issuerId, reason, _wsManager)
  });
}
