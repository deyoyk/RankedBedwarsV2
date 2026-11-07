import { Guild } from 'discord.js';
import { TimedPunishmentKind, TimedPunishmentManager } from './timedPunishmentManager';
import type { WebSocketNotifier } from './punishmentHelpers';

const kind: TimedPunishmentKind = {
  type: 'ban',
  undoType: 'unban',
  pastTense: 'banned',
  undoPastTense: 'unbanned',
  activeWord: 'banned',
  logName: 'BanManager',
  statusField: 'isBanned',
  recordsField: 'bans',
  roleKey: 'banned',
  maxDurationMs: 365 * 24 * 60 * 60 * 1000,
  maxDurationLabel: '1 year',
  defaultUndoReason: 'Unbanned',
  expiryReason: 'Ban expired'
};

export class BanManager extends TimedPunishmentManager {
  private static instance: BanManager;

  protected kind(): TimedPunishmentKind {
    return kind;
  }

  private constructor() {
    super();
  }

  public static getInstance(): BanManager {
    if (!BanManager.instance) {
      BanManager.instance = new BanManager();
    }
    return BanManager.instance;
  }

  public static async ban(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: WebSocketNotifier | null): Promise<Date | undefined> {
    return BanManager.getInstance().apply(guild, targetId, moderatorId, durationStr, reason, wsManager);
  }

  public static async unban(guild: Guild, targetId: string, moderatorId: string, reason = 'Unbanned', wsManager?: WebSocketNotifier | null): Promise<void> {
    return BanManager.getInstance().undo(guild, targetId, moderatorId, reason, wsManager);
  }

  public static async autoUnban(guild: Guild): Promise<number> {
    return BanManager.getInstance().autoExpire(guild);
  }
}
