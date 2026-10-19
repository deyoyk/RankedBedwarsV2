import config from '../config/config';
import { Guild } from 'discord.js';
import { parseDuration } from '../utils/parseDuration';
import { generatePunishmentId, fetchUserWithTimeout, cleanupOperation } from './punishmentBase';
import {
  PunishmentOperation,
  PunishmentManagerStats,
  createPendingOperation,
  addPunishmentRole,
  sendPunishmentNotification,
  sendWebSocketNotification,
  handleOperationError,
  autoExpirePunishments
} from './punishmentHelpers';

export interface TimedPunishmentKind {
  type: string;
  undoType: string;
  pastTense: string;
  undoPastTense: string;
  activeWord: string;
  logName: string;
  statusField: 'isbanned' | 'ismuted';
  recordsField: 'bans' | 'mutes';
  roleKey: 'banned' | 'muted';
  maxDurationMs: number;
  maxDurationLabel: string;
  defaultUndoReason: string;
  expiryReason: string;
}

export abstract class TimedPunishmentManager {
  protected pendingOperations: Map<string, PunishmentOperation> = new Map();
  protected stats: PunishmentManagerStats = {
    total: 0,
    active: 0,
    expired: 0,
    autoResolved: 0,
    errors: 0
  };

  protected abstract kind(): TimedPunishmentKind;
  protected discordApply(promises: Promise<any>[], guild: Guild, targetId: string, reason: string, moderatorId: string, duration: number | null): void {}
  protected discordUndo(promises: Promise<any>[], guild: Guild, targetId: string, reason: string, moderatorId: string): void {}

  public async apply(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | undefined> {
    const kind = this.kind();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    this.pendingOperations.set(operation.id, operation);

    try {
      if (!targetId || !moderatorId || !reason.trim()) {
        throw new Error(`Invalid ${kind.type} parameters`);
      }

      const user = await fetchUserWithTimeout(targetId);
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      const duration = durationStr ? parseDuration(durationStr) : null;
      if (duration !== null && duration < 60000) {
        throw new Error(`${kind.type[0].toUpperCase() + kind.type.slice(1)} duration must be at least 1 minute`);
      }
      if (duration !== null && duration > kind.maxDurationMs) {
        throw new Error(`${kind.type[0].toUpperCase() + kind.type.slice(1)} duration cannot exceed ${kind.maxDurationLabel}`);
      }

      if (user[kind.statusField]) {
        console.warn(`[${kind.logName}] User ${targetId} is already ${kind.activeWord}, updating existing record`);
        const records = user[kind.recordsField] as any[];
        const lastRecord = records[records.length - 1];
        if (lastRecord) {
          lastRecord.reason = reason.trim();
          lastRecord.moderator = moderatorId;
          lastRecord.date = new Date();
          lastRecord.duration = duration ? Math.ceil(duration / 60000) : 0;
          await user.save();
        }
        return undefined;
      }

      const expires = duration ? new Date(Date.now() + duration) : undefined;
      const recordId = generatePunishmentId();

      const record = {
        id: recordId,
        reason: reason.trim(),
        date: new Date(),
        duration: duration ? Math.ceil(duration / 60000) : 0,
        moderator: moderatorId
      };

      (user[kind.recordsField] as any[]).push(record);
      user[kind.statusField] = true;
      await user.save();

      const promises: Promise<any>[] = [];

      addPunishmentRole(promises, guild, targetId, (config.roles as any)[kind.roleKey], 'add', kind.type);
      this.discordApply(promises, guild, targetId, reason, moderatorId, duration);

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: kind.type as any, expires });
      sendWebSocketNotification(promises, wsManager, user, {
        type: kind.type,
        reason,
        duration: duration ? Math.ceil(duration / 60000) : null,
        id: recordId
      }, kind.type);

      await Promise.allSettled(promises);

      operation.status = 'completed';
      this.stats.total++;
      this.stats.active++;

      console.log(`[${kind.logName}] Successfully ${kind.pastTense} ${user.ign || targetId} (${recordId}) for ${durationStr || 'permanent'}: ${reason}`);
      return expires;

    } catch (error: any) {
      handleOperationError(error, operation, this.stats, kind.type, targetId);
    } finally {
      cleanupOperation(this.pendingOperations, operation.id);
    }
  }

  public async undo(guild: Guild, targetId: string, moderatorId: string, reason: string, wsManager?: any): Promise<void> {
    const kind = this.kind();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    this.pendingOperations.set(operation.id, operation);

    try {
      if (!targetId || !moderatorId) {
        throw new Error(`Invalid ${kind.undoType} parameters`);
      }

      const user = await fetchUserWithTimeout(targetId);
      if (!user) {
        throw new Error(`User ${targetId} not found in database`);
      }

      if (!user[kind.statusField]) {
        console.warn(`[${kind.logName}] User ${targetId} is not currently ${kind.activeWord}`);
        return;
      }

      user[kind.statusField] = false;
      await user.save();

      const promises: Promise<any>[] = [];

      addPunishmentRole(promises, guild, targetId, (config.roles as any)[kind.roleKey], 'remove', kind.type);
      this.discordUndo(promises, guild, targetId, reason, moderatorId);

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: kind.undoType as any });
      sendWebSocketNotification(promises, wsManager, user, {
        type: kind.undoType,
        reason,
        id: targetId
      }, kind.type);

      await Promise.allSettled(promises);

      operation.status = 'completed';
      this.stats.active = Math.max(0, this.stats.active - 1);

      console.log(`[${kind.logName}] Successfully ${kind.undoPastTense} ${user.ign || targetId}: ${reason}`);

    } catch (error: any) {
      handleOperationError(error, operation, this.stats, kind.undoType, targetId);
    } finally {
      cleanupOperation(this.pendingOperations, operation.id);
    }
  }

  public async autoExpire(guild: Guild): Promise<number> {
    const kind = this.kind();

    try {
      const count = await autoExpirePunishments(guild, {
        typeName: kind.type,
        statusField: kind.statusField,
        recordsField: kind.recordsField,
        selectFields: `discordId ${kind.recordsField} ign`,
        processExpired: async (g, userId) => {
          await this.undo(g, userId, 'system', kind.expiryReason);
        },
        logPrefix: kind.logName
      });

      this.stats.expired += count;
      return count;

    } catch (error) {
      console.error(`[${kind.logName}] Error in auto-${kind.undoType} process:`, error);
      this.stats.errors++;
      return 0;
    }
  }
}
