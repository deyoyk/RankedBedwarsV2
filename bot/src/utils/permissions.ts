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

export function canUseCommand(
  member: GuildMember | null | undefined,
  command: string,
  isAdmin: boolean = Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator))
): boolean {
  const roles = PermissionService.rolesFor(command);
  if (roles.includes('everyone') || isAdmin) return true;
  if (roles.length === 0) return false;
  return Boolean(member?.roles?.cache && roles.some(roleId => member.roles.cache.has(roleId)));
}

export async function checkPermission(interaction: Message | ChatInputCommandInteraction, command: string): Promise<boolean> {
  if (canUseCommand(interaction.member as GuildMember | null, command, isServerAdmin(interaction))) {
    return true;
  }
  if (PermissionService.rolesFor(command).length === 0) {
    await safeReply(interaction, { content: 'Only server administrators can use this until roles are set in `/rbwconfig`.', flags: 64 });
  }
  return false;
}
