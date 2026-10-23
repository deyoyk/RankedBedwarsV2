import { Message, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { safeReply } from './safeReply';
import type { WebSocketManager } from '../websocket/WebSocketManager';


declare global {
  var _wsManager: WebSocketManager | undefined;
}

export async function checkPermission(interaction: Message | ChatInputCommandInteraction, command: string): Promise<boolean> {
  let commandPermissions: string[] | undefined;
  if (global._wsManager && typeof global._wsManager.getPermission === 'function') {
    commandPermissions = global._wsManager.getPermission(command);
  }
  if (!commandPermissions || commandPermissions.length === 0) {
    await safeReply(interaction, { content: "Permissions for this command not set yet, please contact an admin.", flags: 64 });
    return false;
  }
  if (commandPermissions.includes('everyone')) {
    return true;
  }

  
  const member = (interaction instanceof Message ? interaction.member : interaction.member) as GuildMember;
  
  if (!member) {
    return false;
  }
  
  
  if (commandPermissions.includes('everyone')) {
    return true;
  }

  
  return commandPermissions.some(roleId => member.roles.cache.has(roleId));
}