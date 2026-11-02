import { PlayerData, RecentGame, Helpers, generateThemeImage } from './base';

export type ThemeGenerator = (playerData: PlayerData, recentGames: RecentGame[], helpers: Helpers) => Promise<Buffer>;

const generate = (playerData: PlayerData, recentGames: RecentGame[], helpers: Helpers) =>
  generateThemeImage(playerData, recentGames, helpers);

const registry: Record<string, ThemeGenerator> = {
  default: generate,
};

export function resolveTheme(_name?: string): ThemeGenerator {
  return registry['default'];
}

export const themes = Object.keys(registry);
