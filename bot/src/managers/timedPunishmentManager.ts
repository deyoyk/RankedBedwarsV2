import config from '../config/config';
import { Guild } from 'discord.js';
import User from '../models/User';
import { parseDuration } from '../utils/parseDuration';
import { generatePunishmentId, cleanupOperation } from './punishmentBase';
import {
  PunishmentOperation,
  PunishmentManagerStats,
  PunishmentNotificationType,
  PunishmentRecord,
  WebSocketNotifier,
  createPendingOperation,
  addPunishmentRole,
  sendPunishmentNotification,
  sendWebSocketNotification,
  handleOperationError,
  autoExpirePunishments
} from './punishmentHelpers';

export interface TimedPunishmentKind {
  type: PunishmentNotificationType;
  undoType: PunishmentNotificationType;
  pastTense: string;
  undoPastTense: string;
  activeWord: string;
  logName: string;
  statusField: 'isBanned' | 'isMuted';
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
  protected discordApply(_promises: Promise<unknown>[], _guild: Guild, _targetId: string, _reason: string, _moderatorId: string, _duration: number | null): void {}
  protected discordUndo(_promises: Promise<unknown>[], _guild: Guild, _targetId: string, _reason: string, _moderatorId: string): void {}

  public async apply(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: WebSocketNotifier | null): Promise<Date | undefined> {
    const kind = this.kind();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    this.pendingOperations.set(operation.id, operation);

    try {
      if (!targetId || !moderatorId || !reason.trim()) {
        throw new Error(`Invalid ${kind.type} parameters`);
      }

      const duration = durationStr ? parseDuration(durationStr) : null;
      if (duration !== null && duration < 60000) {
        throw new Error(`${kind.type[0].toUpperCase() + kind.type.slice(1)} duration must be at least 1 minute`);
      }
      if (duration !== null && duration > kind.maxDurationMs) {
        throw new Error(`${kind.type[0].toUpperCase() + kind.type.slice(1)} duration cannot exceed ${kind.maxDurationLabel}`);
      }

      const recordId = generatePunishmentId();
      const record = {
        id: recordId,
        reason: reason.trim(),
        date: new Date(),
        duration: duration ? Math.ceil(duration / 60000) : 0,
        moderator: moderatorId
      };

      const updated = await User.findOneAndUpdate(
        { discordId: targetId, [kind.statusField]: { $ne: true } },
        { $push: { [kind.recordsField]: record }, $set: { [kind.statusField]: true } },
        { new: true }
      );

      if (!updated) {
        const existing = await User.findOne({ discordId: targetId });
        if (!existing) {
          throw new Error(`User ${targetId} not found in database`);
        }
        if (!existing[kind.statusField]) {
          throw new Error(`Failed to apply ${kind.type} to ${targetId}`);
        }
        const records = existing[kind.recordsField] as PunishmentRecord[];
        const lastRecord = records[records.length - 1];
        if (!lastRecord) {
          throw new Error(`User ${targetId} is marked ${kind.activeWord} but has no ${kind.type} record`);
        }
        const refreshed = await User.updateOne(
          { discordId: targetId, [`${kind.recordsField}.id`]: lastRecord.id },
          {
            $set: {
              [`${kind.recordsField}.$.reason`]: reason.trim(),
              [`${kind.recordsField}.$.moderator`]: moderatorId,
              [`${kind.recordsField}.$.date`]: new Date(),
              [`${kind.recordsField}.$.duration`]: duration ? Math.ceil(duration / 60000) : 0
            }
          }
        );
        if (refreshed.matchedCount === 0) {
          throw new Error(`Failed to update existing ${kind.type} record for ${targetId}`);
        }
        return undefined;
      }

      const user = updated;
      const expires = duration ? new Date(Date.now() + duration) : undefined;

      const promises: Promise<unknown>[] = [];

      addPunishmentRole(promises, guild, targetId, config.roles[kind.roleKey], 'add', kind.type);
      this.discordApply(promises, guild, targetId, reason, moderatorId, duration);

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: kind.type, expires });
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

    } catch (error) {
      handleOperationError(error, operation, this.stats, kind.type, targetId);
    } finally {
      cleanupOperation(this.pendingOperations, operation.id);
    }
  }

  public async undo(guild: Guild, targetId: string, moderatorId: string, reason: string, wsManager?: WebSocketNotifier | null): Promise<void> {
    const kind = this.kind();
    const operation = createPendingOperation(targetId, moderatorId, reason);
    this.pendingOperations.set(operation.id, operation);

    try {
      if (!targetId || !moderatorId) {
        throw new Error(`Invalid ${kind.undoType} parameters`);
      }

      const cleared = await User.updateOne(
        { discordId: targetId, [kind.statusField]: true },
        { $set: { [kind.statusField]: false } }
      );
      if (cleared.matchedCount === 0) {
        const exists = await User.findOne({ discordId: targetId });
        if (!exists) {
          throw new Error(`User ${targetId} not found in database`);
        }
        console.warn(`[${kind.logName}] User ${targetId} is not currently ${kind.activeWord}`);
        return;
      }

      const user = (await User.findOne({ discordId: targetId })) ?? { discordId: targetId, ign: undefined as string | undefined };

      const promises: Promise<unknown>[] = [];

      addPunishmentRole(promises, guild, targetId, config.roles[kind.roleKey], 'remove', kind.type);
      this.discordUndo(promises, guild, targetId, reason, moderatorId);

      sendPunishmentNotification(promises, { guild, targetId, moderatorId, reason, type: kind.undoType });
      sendWebSocketNotification(promises, wsManager, user, {
        type: kind.undoType,
        reason,
        id: targetId
      }, kind.type);

      await Promise.allSettled(promises);

      operation.status = 'completed';
      this.stats.active = Math.max(0, this.stats.active - 1);

      console.log(`[${kind.logName}] Successfully ${kind.undoPastTense} ${user.ign || targetId}: ${reason}`);

    } catch (error) {
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
