import ScreenshareState, { IScreenshareState } from '../models/ScreenshareState';
import { recordAudit } from './AuditService';

export type ScreenshareSwitchView = Omit<IScreenshareState, 'guildId'>;

export const SCREENSHARE_OFF_MESSAGE = 'Screensharing is turned off right now, so no screenshare can be requested.';

export class ScreenshareSwitch {
  private static guildId = '';
  private static state: ScreenshareSwitchView = { enabled: true, by: '', at: new Date(0) };

  static async load(guildId: string): Promise<void> {
    ScreenshareSwitch.guildId = guildId;
    const doc = await ScreenshareState.findOne({ guildId }).lean();
    if (doc) {
      ScreenshareSwitch.state = { enabled: doc.enabled, by: doc.by, at: doc.at };
    }
  }

  static current(): ScreenshareSwitchView {
    return ScreenshareSwitch.state;
  }

  static async set(enabled: boolean, by: string): Promise<ScreenshareSwitchView> {
    if (!ScreenshareSwitch.guildId) {
      throw new Error('The screenshare switch is not loaded yet');
    }
    const next: ScreenshareSwitchView = { enabled, by, at: new Date() };
    const before = { ...ScreenshareSwitch.state };
    await ScreenshareState.updateOne({ guildId: ScreenshareSwitch.guildId }, { $set: next }, { upsert: true });
    ScreenshareSwitch.state = next;
    await recordAudit({
      action: 'config.screenshare_switch',
      category: 'config',
      source: 'discord',
      success: true,
      actorId: by,
      guildId: ScreenshareSwitch.guildId,
      before: { enabled: before.enabled },
      after: { enabled: next.enabled },
    });
    return next;
  }
}
