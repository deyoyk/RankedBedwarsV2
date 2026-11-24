import type { IPresetStep, PresetType } from '../models/PunishmentPreset';
import { checkStrikes, cleanPresetName, parseSteps } from './PunishmentPresets';
import { checkAction, MAX_RULES, StrikeRuleSettings } from './StrikeRuleService';

export const MAX_IMPORT_BYTES = 256 * 1024;
const MAX_IMPORT_PRESETS = 200;
const TYPES: PresetType[] = ['ban', 'mute', 'strike'];

export interface ImportedPreset {
  name: string;
  type: PresetType;
  reason: string;
  steps: IPresetStep[];
  strikes?: number;
}

export interface PresetFile {
  presets: ImportedPreset[];
  strikeRules: StrikeRuleSettings | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readPreset(raw: unknown, index: number): ImportedPreset {
  const where = `Preset ${index + 1}`;
  if (!isObject(raw)) throw new Error(`${where} isn't an object.`);
  if (typeof raw.name !== 'string') throw new Error(`${where} has no \`name\`.`);
  const name = cleanPresetName(raw.name);
  const type = raw.type as PresetType;
  if (!TYPES.includes(type)) throw new Error(`\`${name}\`: \`type\` must be ban, mute or strike.`);
  if (typeof raw.reason !== 'string' || !raw.reason.trim() || raw.reason.length > 200) {
    throw new Error(`\`${name}\`: \`reason\` must be 1-200 characters.`);
  }
  if (type === 'strike') {
    if (raw.strikes !== undefined && typeof raw.strikes !== 'number') throw new Error(`\`${name}\`: \`strikes\` must be a number.`);
    return { name, type, reason: raw.reason.trim(), steps: [], strikes: checkStrikes((raw.strikes as number | undefined) ?? 1) };
  }
  if (typeof raw.durations !== 'string') throw new Error(`\`${name}\`: a ${type} preset needs \`durations\`, like "1d, 7d, perm".`);
  try {
    return { name, type, reason: raw.reason.trim(), steps: parseSteps(raw.durations) };
  } catch (error) {
    if (error instanceof Error) error.message = `\`${name}\`: ${error.message}`;
    throw error;
  }
}

function readStrikeRules(raw: unknown): StrikeRuleSettings {
  if (!isObject(raw) || !Array.isArray(raw.rules) || typeof raw.otherwise !== 'string') {
    throw new Error('`strikeRules` needs a `rules` list and an `otherwise` action.');
  }
  if (raw.rules.length > MAX_RULES) throw new Error(`\`strikeRules\` can have at most ${MAX_RULES} rules.`);
  const seen = new Set<number>();
  const rules = raw.rules.map((rule, i) => {
    if (!isObject(rule) || !Number.isInteger(rule.strikes) || (rule.strikes as number) < 1 || (rule.strikes as number) > 1000
      || typeof rule.action !== 'string') {
      throw new Error(`Strike rule ${i + 1} needs a whole number of \`strikes\` (1-1000) and an \`action\`.`);
    }
    if (seen.has(rule.strikes as number)) throw new Error(`There are two strike rules for ${rule.strikes} strikes.`);
    seen.add(rule.strikes as number);
    return { strikes: rule.strikes as number, action: checkAction(rule.action) };
  });
  return { rules: rules.sort((a, b) => a.strikes - b.strikes), otherwise: checkAction(raw.otherwise) };
}

export function parsePresetFile(text: string): PresetFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isObject(data) || !Array.isArray(data.presets)) {
    throw new Error('The file needs a `presets` list.');
  }
  if (data.presets.length === 0 || data.presets.length > MAX_IMPORT_PRESETS) {
    throw new Error(`The file needs 1 to ${MAX_IMPORT_PRESETS} presets.`);
  }
  const presets = data.presets.map(readPreset);
  const names = new Set<string>();
  for (const preset of presets) {
    if (names.has(preset.name)) throw new Error(`\`${preset.name}\` is in the file twice.`);
    names.add(preset.name);
  }
  return { presets, strikeRules: data.strikeRules === undefined ? null : readStrikeRules(data.strikeRules) };
}
