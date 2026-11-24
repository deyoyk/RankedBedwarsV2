import config from '../config/config';
import StrikeRules, { IStrikeRule } from '../models/StrikeRules';
import { parseDuration } from '../utils/parseDuration';

export const MAX_RULES = 20;

export interface StrikeRuleSettings {
  rules: IStrikeRule[];
  otherwise: string;
}

export function defaultsFromConfig(strikes: Record<string, string> = config.strikes || {}): StrikeRuleSettings {
  const rules = Object.entries(strikes)
    .filter(([count]) => /^\d+$/.test(count))
    .map(([count, action]) => ({ strikes: Number(count), action: action || 'warn' }))
    .sort((a, b) => a.strikes - b.strikes);
  return { rules, otherwise: strikes.default || 'warn' };
}

export function checkAction(action: string): string {
  const clean = action.trim().toLowerCase().replace(/^\+\s*/, '+');
  if (clean === 'warn') {
    return clean;
  }
  if (clean.startsWith('+')) {
    const step = parseDuration(clean.slice(1));
    if (step === null || step < 60000) {
      throw new Error('Adding per strike needs a duration of at least a minute, like `+14d`.');
    }
    return clean;
  }
  const ms = parseDuration(clean);
  if (ms !== null && ms < 60000) {
    throw new Error('A ban has to be at least a minute.');
  }
  return clean;
}

export function actionFor(settings: StrikeRuleSettings, strikeCount: number): string {
  const exact = settings.rules.find(rule => rule.strikes === strikeCount);
  if (exact) {
    return exact.action;
  }
  if (!settings.otherwise.startsWith('+')) {
    return settings.otherwise;
  }
  const last = settings.rules[settings.rules.length - 1];
  if (!last || strikeCount < last.strikes) {
    return 'warn';
  }
  const base = parseDuration(last.action);
  if (base === null) {
    return last.action;
  }
  const step = parseDuration(settings.otherwise.slice(1)) ?? 0;
  return compactDuration(base + step * (strikeCount - last.strikes));
}

export function compactDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function describeAction(action: string): string {
  if (action === 'warn') {
    return 'warning only';
  }
  if (action.startsWith('+')) {
    return `${action.slice(1)} more per strike after the last rule`;
  }
  return parseDuration(action) === null ? 'permanent rank ban' : `rank ban for ${action}`;
}

export class StrikeRuleService {
  private static guildId = '';
  private static settings: StrikeRuleSettings = defaultsFromConfig();

  static async load(guildId: string): Promise<void> {
    StrikeRuleService.guildId = guildId;
    const doc = await StrikeRules.findOne({ guildId }).lean();
    StrikeRuleService.settings = doc ? { rules: [...doc.rules].sort((a, b) => a.strikes - b.strikes), otherwise: doc.otherwise } : defaultsFromConfig();
  }

  static current(): StrikeRuleSettings {
    return StrikeRuleService.settings;
  }

  static actionFor(strikeCount: number): string {
    return actionFor(StrikeRuleService.settings, strikeCount);
  }

  static async setRule(strikes: number, action: string): Promise<StrikeRuleSettings> {
    if (!Number.isInteger(strikes) || strikes < 1 || strikes > 1000) {
      throw new Error('The number of strikes has to be a whole number from 1 to 1000.');
    }
    const checked = checkAction(action);
    const rules = StrikeRuleService.settings.rules.filter(rule => rule.strikes !== strikes);
    if (rules.length >= MAX_RULES) {
      throw new Error(`There can be at most ${MAX_RULES} rules.`);
    }
    rules.push({ strikes, action: checked });
    return StrikeRuleService.save({ ...StrikeRuleService.settings, rules });
  }

  static async removeRules(strikes: number[]): Promise<StrikeRuleSettings> {
    const rules = StrikeRuleService.settings.rules.filter(rule => !strikes.includes(rule.strikes));
    return StrikeRuleService.save({ ...StrikeRuleService.settings, rules });
  }

  static async replace(settings: StrikeRuleSettings): Promise<StrikeRuleSettings> {
    if (settings.rules.length > MAX_RULES) {
      throw new Error(`There can be at most ${MAX_RULES} rules.`);
    }
    return StrikeRuleService.save({
      rules: settings.rules.map(rule => ({ strikes: rule.strikes, action: checkAction(rule.action) })),
      otherwise: checkAction(settings.otherwise),
    });
  }

  static async setOtherwise(action: string): Promise<StrikeRuleSettings> {
    return StrikeRuleService.save({ ...StrikeRuleService.settings, otherwise: checkAction(action) });
  }

  private static async save(next: StrikeRuleSettings): Promise<StrikeRuleSettings> {
    if (!StrikeRuleService.guildId) {
      throw new Error('Strike rules are not loaded yet');
    }
    const sorted = { rules: [...next.rules].sort((a, b) => a.strikes - b.strikes), otherwise: next.otherwise };
    await StrikeRules.updateOne({ guildId: StrikeRuleService.guildId }, { $set: sorted }, { upsert: true });
    StrikeRuleService.settings = sorted;
    return sorted;
  }
}
