import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { BanManager } from '../../managers/BanManager';
import { executeUnmoderationAction } from '../../utils/modCommands';

export async function unban(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  await executeUnmoderationAction(interaction, args, {
    commandName: 'unban',
    actionVerb: 'Unbanned',
    managerCall: (guild, targetId, issuerId) => BanManager.unban(guild, targetId, issuerId)
  });
}
