import mongoose from 'mongoose';
import type { ChatInputCommandInteraction, CommandInteractionOption } from 'discord.js';
import AuditLog from '../models/AuditLog';

export type { AuditSource } from '../models/AuditLog';
type AuditSource = import('../models/AuditLog').AuditSource;

export interface AuditInput {
  action: string;
  category?: string;
  source?: AuditSource;
  success?: boolean;
  actorId?: string;
  actorName?: string;
  guildId?: string;
  channelId?: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  commandName?: string;
  reason?: string;
  error?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export interface AuditInteractionContext {
  actorId?: string;
  actorName?: string;
  guildId?: string;
  channelId?: string;
}

export function isAuditStorageReady(): boolean {
  return mongoose.connection.readyState === 1;
}

/** Writes an audit entry without letting an audit failure break the action it describes. */
export async function recordAudit(input: AuditInput): Promise<void> {
  if (!isAuditStorageReady()) return;
  try {
    const { category = 'system', source = 'system', success = true, ...rest } = input;
    await AuditLog.create({
      category,
      source,
      success,
      ...rest,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error('[Audit] Failed to write audit entry:', error);
  }
}

export function auditInteractionContext(interaction: ChatInputCommandInteraction): AuditInteractionContext {
  return {
    actorId: interaction.user?.id,
    actorName: interaction.user?.tag,
    guildId: interaction.guildId ?? undefined,
    channelId: interaction.channelId ?? undefined,
  };
}

function serializeOption(option: CommandInteractionOption): unknown {
  if (option.options) {
    return Object.fromEntries(option.options.map(child => [child.name, serializeOption(child)]));
  }
  if (option.user) {
    return { id: option.user.id, username: option.user.username };
  }
  if (option.member) {
    const member = option.member as {
      id?: string;
      displayName?: string;
      user?: { id: string; username: string };
    };
    return {
      id: member.id ?? member.user?.id,
      displayName: member.displayName ?? member.user?.username,
    };
  }
  if (option.role) {
    return { id: option.role.id, name: option.role.name };
  }
  if (option.channel) {
    return { id: option.channel.id, name: (option.channel as { name?: string }).name };
  }
  if (option.attachment) {
    return { id: option.attachment.id, name: option.attachment.name, url: option.attachment.url };
  }
  return option.value;
}

/** The full command input, with users/channels/roles reduced to IDs and names. */
export function describeCommandOptions(interaction: ChatInputCommandInteraction): Record<string, unknown> {
  const data = interaction.options?.data;
  if (!Array.isArray(data)) return {};
  return Object.fromEntries(data.map(option => [option.name, serializeOption(option)]));
}

export interface AuditTarget {
  targetType: string;
  targetId: string;
  targetName?: string;
}

/** Best-effort target extraction from the common user/user_id/target options. */
export function auditTargetFromOptions(interaction: ChatInputCommandInteraction): AuditTarget | undefined {
  const data = interaction.options?.data;
  if (!Array.isArray(data)) return undefined;
  const findUser = (options: readonly CommandInteractionOption[]): AuditTarget | undefined => {
    for (const option of options) {
      if (option.options) {
        const nested = findUser(option.options);
        if (nested) return nested;
      }
      if (option.user && (!option.name || ['user', 'user_id', 'target'].includes(option.name))) {
        return { targetType: 'user', targetId: option.user.id, targetName: option.user.username };
      }
      if (option.value && ['user_id', 'target'].includes(option.name) && /^\d{17,20}$/.test(String(option.value))) {
        return { targetType: 'user', targetId: String(option.value) };
      }
    }
    return undefined;
  };
  return findUser(data);
}
