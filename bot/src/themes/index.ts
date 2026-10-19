import { PlayerData, RecentGame, Helpers, generateThemeImage } from './base';

export type ThemeGenerator = (playerData: any, recentGames: any[], helpers: { calculateRating?: (pd: any) => number; calculatePosition: (discordId: string) => number | string | Promise<number | string> }) => Promise<Buffer>;

const generate = (playerData: PlayerData, recentGames: RecentGame[], helpers: Helpers) =>
  generateThemeImage(playerData, recentGames, helpers);

const registry: Record<string, ThemeGenerator> = {
  default: generate,
};

export function resolveTheme(_name?: string): ThemeGenerator {
  return registry['default'];
}

export const themes = Object.keys(registry);
