import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { BanManager } from '../../managers/BanManager';
import { executeModerationAction } from '../../utils/modCommands';

export async function ban(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  await executeModerationAction(interaction, {
    commandName: 'ban',
    actionVerb: 'Banned',
    managerCall: (guild, targetId, issuerId, duration, reason) => BanManager.ban(guild, targetId, issuerId, duration, reason),
    hasDuration: true
  });
}
