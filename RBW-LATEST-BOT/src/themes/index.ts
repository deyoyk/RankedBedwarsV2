import deyo from './deyo';
import elite from './elite';
import lunar from './lunar';
import rich from './rich';
import y2k from './y2k';

export type ThemeGenerator = (playerData: any, recentGames: any[], helpers: { calculateRating?: (pd: any) => number; calculatePosition: (discordId: string) => number | string | Promise<number | string> }) => Promise<Buffer>;

const registry: Record<string, ThemeGenerator> = {
  deyo: deyo.generate,
  elite: elite.generate,
  lunar: lunar.generate,
  rich: rich.generate,
  y2k: y2k.generate,
};

export function resolveTheme(name?: string): ThemeGenerator {
  if (!name) return registry['elite'];
  const key = name.toLowerCase();
  return registry[key] || registry['elite'];
}

export const themes = Object.keys(registry);