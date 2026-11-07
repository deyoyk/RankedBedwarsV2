import { ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { MuteManager } from '../../managers/MuteManager';
import { executeUnmoderationAction } from '../../utils/modCommands';

export async function unmute(interaction: ChatInputCommandInteraction, _wsManager?: WebSocketManager) {
  await executeUnmoderationAction(interaction, {
    commandName: 'unmute',
    actionVerb: 'Unmuted',
    managerCall: (guild, targetId, issuerId) => MuteManager.unmute(guild, targetId, issuerId)
  });
}
