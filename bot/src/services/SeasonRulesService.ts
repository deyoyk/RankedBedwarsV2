import SeasonRules, { ISeasonRules } from '../models/SeasonRules';

export interface RuleSets {
  season: string[];
  ppp: string[];
}

const KEY = 'global';

function lines(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string') : [];
}

export class SeasonRulesService {
  static async save(season: unknown, ppp: unknown): Promise<RuleSets> {
    const rules = { season: lines(season), ppp: lines(ppp) };
    await SeasonRules.updateOne({ key: KEY }, { $set: { ...rules, updatedAt: new Date() } }, { upsert: true });
    return rules;
  }

  static async get(): Promise<RuleSets | null> {
    const doc = await SeasonRules.findOne({ key: KEY }).lean<ISeasonRules>();
    return doc ? { season: doc.season, ppp: doc.ppp } : null;
  }
}
