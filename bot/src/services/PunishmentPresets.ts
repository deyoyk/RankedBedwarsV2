import type { UpdateQuery } from 'mongoose';
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

export function cleanPresetName(name: string): string {
  const clean = name.trim().toLowerCase();
  if (!PRESET_NAME.test(clean)) {
    throw new Error('A preset name is 1-32 letters, numbers, `-` or `_`, like `cheating`.');
  }
  return clean;
}

export function checkStrikes(strikes: number | undefined): number | undefined {
  if (strikes === undefined) return undefined;
  if (!Number.isInteger(strikes) || strikes < 1 || strikes > 10) {
    throw new Error('A strike preset gives 1 to 10 strikes.');
  }
  return strikes;
}

function presetUpdate(type: PresetType, steps: IPresetStep[], reason: string, createdBy: string,
                      strikes?: number): UpdateQuery<IPunishmentPreset> {
  const set = { type, steps, reason: reason.trim(), createdBy, updatedAt: new Date() };
  return type === 'strike' && strikes !== undefined
    ? { $set: { ...set, strikes: checkStrikes(strikes) } }
    : { $set: set, $unset: { strikes: 1 as const } };
}

export function describeSteps(preset: IPunishmentPreset): string {
  if (preset.type === 'strike') {
    const count = preset.strikes ?? 1;
    return `${count} strike${count === 1 ? '' : 's'}`;
  }
  if (preset.steps.length === 0) {
    return 'no duration';
  }
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

  static async save(name: string, type: PresetType, steps: IPresetStep[], reason: string, createdBy: string,
                    strikes?: number): Promise<IPunishmentPreset> {
    const saved = await PunishmentPreset.findOneAndUpdate(
      { name: cleanPresetName(name) },
      presetUpdate(type, steps, reason, createdBy, strikes),
      { upsert: true, new: true }
    ).lean<IPunishmentPreset>();
    await this.changed();
    return saved as IPunishmentPreset;
  }

  static async saveAll(presets: Array<{ name: string; type: PresetType; steps: IPresetStep[]; reason: string; strikes?: number }>,
                       createdBy: string): Promise<number> {
    const operations = presets.map(p => ({
      updateOne: {
        filter: { name: cleanPresetName(p.name) },
        update: presetUpdate(p.type, p.steps, p.reason, createdBy, p.strikes),
        upsert: true,
      },
    }));
    await PunishmentPreset.bulkWrite(operations);
    await this.changed();
    return operations.length;
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
