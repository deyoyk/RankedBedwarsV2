import { PermissionFlagsBits } from 'discord.js';

export const TARGET_THREAD_ACCESS = {
  ViewChannel: true,
  ReadMessageHistory: true,
  SendMessagesInThreads: true,
  SendMessages: false
} as const;

const TARGET_ALLOW = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.SendMessagesInThreads;
const TARGET_DENY = PermissionFlagsBits.SendMessages;

export function isTargetThreadAccess(allow: bigint, deny: bigint): boolean {
  return allow === TARGET_ALLOW && deny === TARGET_DENY;
}

export function screenshareThreadPing(roleId: string | undefined, targetId: string) {
  const roles = roleId ? [roleId] : [];
  return {
    content: [...roles.map(id => `<@&${id}>`), `<@${targetId}>`].join(' '),
    allowedMentions: { roles, users: [targetId] }
  };
}
