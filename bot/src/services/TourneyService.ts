import TourneyState, { ITourneyState } from '../models/TourneyState';
import { recordAudit } from './AuditService';

export type TourneyView = Omit<ITourneyState, 'guildId'>;

export function wire(state: TourneyView): { type: 'pg_tourney'; enabled: boolean; by: string; source: string } {
  return { type: 'pg_tourney', enabled: state.enabled, by: state.by, source: state.source };
}

export class TourneyService {
  private static guildId = '';
  private static state: TourneyView = { enabled: false, by: '', source: 'discord', at: new Date(0) };
  private static listeners: Array<(state: TourneyView) => void> = [];

  static async load(guildId: string): Promise<void> {
    TourneyService.guildId = guildId;
    const doc = await TourneyState.findOne({ guildId }).lean();
    if (doc) {
      TourneyService.state = { enabled: doc.enabled, by: doc.by, source: doc.source, at: doc.at };
    }
  }

  static current(): TourneyView {
    return TourneyService.state;
  }

  static onChange(listener: (state: TourneyView) => void): void {
    TourneyService.listeners.push(listener);
  }

  static async set(enabled: boolean, by: string, source: 'discord' | 'minecraft'): Promise<TourneyView> {
    if (!TourneyService.guildId) {
      throw new Error('Tourney mode is not loaded yet');
    }
    const next: TourneyView = { enabled, by, source, at: new Date() };
    const before = { ...TourneyService.state };
    await TourneyState.updateOne({ guildId: TourneyService.guildId }, { $set: next }, { upsert: true });
    TourneyService.state = next;
    await recordAudit({
      action: 'config.tourney',
      category: 'config',
      source,
      success: true,
      actorId: by,
      guildId: TourneyService.guildId,
      before: { enabled: before.enabled, by: before.by, source: before.source },
      after: { enabled: next.enabled, by: next.by, source: next.source },
    });
    for (const listener of TourneyService.listeners) {
      try {
        listener(next);
      } catch (error) {
        console.warn('[TourneyService] A listener failed:', error instanceof Error ? error.message : error);
      }
    }
    return next;
  }
}
