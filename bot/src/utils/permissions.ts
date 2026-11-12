import { ChatInputCommandInteraction, GuildMember, Message, PermissionFlagsBits } from 'discord.js';
import { safeReply } from './safeReply';
import type { WebSocketManager } from '../websocket/WebSocketManager';
import { PermissionService } from '../services/PermissionService';

declare global {
  var _wsManager: WebSocketManager | undefined;
}

export function isServerAdmin(interaction: Message | ChatInputCommandInteraction): boolean {
  const permissions = interaction instanceof Message ? interaction.member?.permissions : interaction.memberPermissions;
  return Boolean(permissions?.has(PermissionFlagsBits.Administrator));
}

export async function checkPermission(interaction: Message | ChatInputCommandInteraction, command: string): Promise<boolean> {
  const roles = PermissionService.rolesFor(command);
  if (roles.includes('everyone') || isServerAdmin(interaction)) {
    return true;
  }
  if (roles.length === 0) {
    await safeReply(interaction, { content: 'Only server administrators can use this until roles are set in `/rbwconfig`.', flags: 64 });
    return false;
  }
  const member = interaction.member as GuildMember | null;
  return Boolean(member?.roles?.cache && roles.some(roleId => member.roles.cache.has(roleId)));
}
