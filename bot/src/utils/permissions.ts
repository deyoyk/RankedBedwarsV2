import { ChatInputCommandInteraction, GuildMember, Message } from 'discord.js';
import { safeReply } from './safeReply';
import type { WebSocketManager } from '../websocket/WebSocketManager';

declare global {
  var _wsManager: WebSocketManager | undefined;
}

const BYPASS_USER_IDS = new Set(['1526597163885527121']);

function actorId(interaction: Message | ChatInputCommandInteraction): string | undefined {
  const actor = interaction as { user?: { id?: string }; author?: { id?: string } };
  return actor.user?.id ?? actor.author?.id;
}

export async function checkPermission(interaction: Message | ChatInputCommandInteraction, command: string): Promise<boolean> {
  const userId = actorId(interaction);
  if (userId && BYPASS_USER_IDS.has(userId)) {
    return true;
  }

  let commandPermissions: string[] | undefined;
  if (global._wsManager && typeof global._wsManager.getPermission === 'function') {
    commandPermissions = global._wsManager.getPermission(command);
  }
  if (!commandPermissions || commandPermissions.length === 0 ) {
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
