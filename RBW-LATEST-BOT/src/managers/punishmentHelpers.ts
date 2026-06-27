import config from '../config/config';
import { Guild } from 'discord.js';
import { sendPunishmentEmbed } from '../utils/punishmentEmbed';
import { generatePunishmentId } from './punishmentBase';

export interface PunishmentOperation {
  id: string;
  targetId: string;
  moderatorId: string;
  reason: string;
  duration?: number;
  timestamp: number;
  status: 'pending' | 'completed' | 'failed';
  actionTaken?: string;
}

export interface PunishmentManagerStats {
  total: number;
  active: number;
  expired: number;
  autoResolved: number;
  errors: number;
}

export function createPendingOperation(
  targetId: string,
  moderatorId: string,
  reason: string,
  duration?: number
): PunishmentOperation {
  return {
    id: generatePunishmentId(),
    targetId,
    moderatorId,
    reason,
    duration,
    timestamp: Date.now(),
    status: 'pending'
  };
}

export function addPunishmentRole(
  promises: Promise<any>[],
  guild: Guild,
  targetId: string,
  roleId: string | undefined,
  action: 'add' | 'remove',
  typeName: string
): void {
  if (!roleId) return;
  const member = guild.members.cache.get(targetId);
  if (!member) return;
  promises.push(
    (action === 'add' ? member.roles.add(roleId) : member.roles.remove(roleId)).catch(error => {
      console.warn(`[${typeName}Manager] Failed to ${action} ${typeName} role from ${targetId}:`, error.message);
    })
  );
}

export function sendPunishmentNotification(
  promises: Promise<any>[],
  params: {
    guild: Guild;
    targetId: string;
    moderatorId: string;
    reason: string;
    type: 'strike' | 'ban' | 'mute' | 'unban' | 'unmute' | 'unstrike';
    expires?: Date;
  }
): void {
  promises.push(
    sendPunishmentEmbed(params).catch(error => {
      console.warn(`[${params.type}Manager] Failed to send ${params.type} embed:`, error.message);
    })
  );
}

export function sendWebSocketNotification(
  promises: Promise<any>[],
  wsManager: any,
  user: any,
  params: {
    type: string;
    reason: string;
    duration?: number | null;
    id: string;
  },
  typeName: string
): void {
  if (!wsManager || typeof wsManager.send !== 'function') return;
  promises.push(
    Promise.resolve().then(() => {
      wsManager.send({
        type: `bot${params.type}`,
        ign: user.ign,
        reason: params.reason.trim(),
        duration: params.duration ?? null,
        id: params.id
      });
    }).catch(error => {
      console.warn(`[${typeName}Manager] Failed to send WebSocket ${typeName} notification:`, error.message);
    })
  );
}

export function handleOperationError(
  error: any,
  operation: PunishmentOperation,
  stats: PunishmentManagerStats,
  typeName: string,
  targetId: string
): never {
  operation.status = 'failed';
  stats.errors++;
  console.error(`[${typeName}Manager] Failed to ${typeName} ${targetId}:`, error);
  throw new Error(`${typeName} operation failed: ${error.message}`);
}

export async function batchProcessExpired<T>(
  items: T[],
  processor: (item: T) => Promise<boolean>,
  batchSize: number,
  delayMs: number
): Promise<number> {
  let successCount = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(processor));
    successCount += results.filter(
      r => r.status === 'fulfilled' && r.value === true
    ).length;
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return successCount;
}
