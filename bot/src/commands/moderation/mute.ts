import { Message, ChatInputCommandInteraction } from 'discord.js';
import type { WebSocketManager } from '../../websocket/WebSocketManager';
import { MuteManager } from '../../managers/MuteManager';
import { executeModerationAction } from '../../utils/modCommands';

export async function mute(interaction: Message | ChatInputCommandInteraction, args?: string[], wsManager?: WebSocketManager) {
  await executeModerationAction(interaction, args, {
    commandName: 'mute',
    actionVerb: 'Muted',
    managerCall: (guild, targetId, issuerId, duration, reason) => MuteManager.mute(guild, targetId, issuerId, duration, reason),
    hasDuration: true
  });
}
