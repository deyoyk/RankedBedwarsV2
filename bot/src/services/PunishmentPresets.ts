import PunishmentPreset, { IPresetStep, IPunishmentPreset, PresetType } from '../models/PunishmentPreset';
import { parseDuration } from '../utils/parseDuration';

export const PRESET_NAME = /^[a-z0-9_-]{1,32}$/;
const MAX_STEPS = 10;

export interface PresetRecord {
  preset?: string;
}

export interface ResolvedPreset {
  preset: IPunishmentPreset;
  offence: number;
  duration: string;
  reason: string;
}

export interface WirePreset {
  name: string;
  type: PresetType;
  reason: string;
  steps: Array<{ minutes: number | null; reason: string | null }>;
}

export function parseSteps(text: string): IPresetStep[] {
  const parts = text.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Give at least one duration, like `1d` or `1d, 7d, perm`.');
  }
  if (parts.length > MAX_STEPS) {
    throw new Error(`A preset can have at most ${MAX_STEPS} steps.`);
  }
  return parts.map(part => {
    const colon = part.indexOf(':');
    const duration = (colon < 0 ? part : part.slice(0, colon)).trim();
    const reason = colon < 0 ? '' : part.slice(colon + 1).trim();
    const ms = parseDuration(duration);
    if (ms !== null && ms < 60000) {
      throw new Error(`\`${duration}\` is shorter than a minute.`);
    }
    return reason ? { duration, reason } : { duration };
  });
}

export function resolvePreset(preset: IPunishmentPreset, records: PresetRecord[]): ResolvedPreset {
  const previous = records.filter(record => record.preset === preset.name).length;
  const step = preset.steps[Math.min(previous, preset.steps.length - 1)];
  return {
    preset,
    offence: previous + 1,
    duration: step.duration,
    reason: step.reason || preset.reason
  };
}

export function toWire(preset: IPunishmentPreset): WirePreset {
  return {
    name: preset.name,
    type: preset.type,
    reason: preset.reason,
    steps: preset.steps.map(step => {
      const ms = parseDuration(step.duration);
      return { minutes: ms === null ? null : Math.ceil(ms / 60000), reason: step.reason || null };
    })
  };
}

export function describeSteps(preset: IPunishmentPreset): string {
  return preset.steps.map(step => step.duration + (step.reason ? ` (${step.reason})` : '')).join(' → ');
}

export class PunishmentPresets {
  private static cache: IPunishmentPreset[] | null = null;
  private static listeners: Array<(presets: WirePreset[]) => void> = [];

  static async all(): Promise<IPunishmentPreset[]> {
    if (!this.cache) {
      this.cache = await PunishmentPreset.find().sort({ name: 1 }).lean<IPunishmentPreset[]>();
    }
    return this.cache;
  }

  static async get(name: string): Promise<IPunishmentPreset | null> {
    const wanted = name.trim().toLowerCase();
    return (await this.all()).find(preset => preset.name === wanted) ?? null;
  }

  static async save(name: string, type: PresetType, steps: IPresetStep[], reason: string, createdBy: string): Promise<IPunishmentPreset> {
    const cleanName = name.trim().toLowerCase();
    if (!PRESET_NAME.test(cleanName)) {
      throw new Error('A preset name is 1-32 letters, numbers, `-` or `_`, like `cheating`.');
    }
    const saved = await PunishmentPreset.findOneAndUpdate(
      { name: cleanName },
      { $set: { type, steps, reason: reason.trim(), createdBy, updatedAt: new Date() } },
      { upsert: true, new: true }
    ).lean<IPunishmentPreset>();
    await this.changed();
    return saved as IPunishmentPreset;
  }

  static async remove(name: string): Promise<boolean> {
    const result = await PunishmentPreset.deleteOne({ name: name.trim().toLowerCase() });
    await this.changed();
    return result.deletedCount > 0;
  }

  static async wire(): Promise<WirePreset[]> {
    return (await this.all()).map(toWire);
  }

  static onChange(listener: (presets: WirePreset[]) => void): void {
    this.listeners.push(listener);
  }

  private static async changed(): Promise<void> {
    this.cache = null;
    const presets = await this.wire();
    for (const listener of this.listeners) {
      try {
        listener(presets);
      } catch (error) {
        console.warn('[PunishmentPresets] A listener failed:', error instanceof Error ? error.message : error);
      }
    }
  }
}
