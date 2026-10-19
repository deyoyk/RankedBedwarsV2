import { Guild } from 'discord.js';
import { TimedPunishmentManager, TimedPunishmentKind } from './timedPunishmentManager';

const kind: TimedPunishmentKind = {
  type: 'mute',
  undoType: 'unmute',
  pastTense: 'muted',
  undoPastTense: 'unmuted',
  activeWord: 'muted',
  logName: 'MuteManager',
  statusField: 'ismuted',
  recordsField: 'mutes',
  roleKey: 'muted',
  maxDurationMs: 30 * 24 * 60 * 60 * 1000,
  maxDurationLabel: '30 days',
  defaultUndoReason: 'Unmuted',
  expiryReason: 'Mute expired'
};

export class MuteManager extends TimedPunishmentManager {
  private static instance: MuteManager;

  protected kind(): TimedPunishmentKind {
    return kind;
  }

  private constructor() {
    super();
  }

  public static getInstance(): MuteManager {
    if (!MuteManager.instance) {
      MuteManager.instance = new MuteManager();
    }
    return MuteManager.instance;
  }

  public static async mute(guild: Guild, targetId: string, moderatorId: string, durationStr: string, reason: string, wsManager?: any): Promise<Date | undefined> {
    return MuteManager.getInstance().apply(guild, targetId, moderatorId, durationStr, reason, wsManager);
  }

  public static async unmute(guild: Guild, targetId: string, moderatorId: string, reason = 'Unmuted', wsManager?: any): Promise<void> {
    return MuteManager.getInstance().undo(guild, targetId, moderatorId, reason, wsManager);
  }

  public static async autoUnmute(guild: Guild): Promise<number> {
    return MuteManager.getInstance().autoExpire(guild);
  }
}
