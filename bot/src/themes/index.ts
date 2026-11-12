import type { Helpers, PlayerData, RecentGame } from './base';
import veltrix from './veltrix';
import halloween from './halloween';
import christmas from './christmas';
import newyear from './newyear';
import garou from './garou';
import alucard from './alucard';
import moon from './moon';
import mahoraga from './mahoraga';
import obsidian from './obsidian';
import impact from './impact';
import staticTheme from './static';
import skyline from './skyline';
import reach from './reach';
import spiderman from './spiderman';
import comic from './comic';
import aether from './aether';
import nature from './nature';
import gojo from './gojo';

export type ThemeGenerator = (playerData: PlayerData, recentGames: RecentGame[], helpers: Helpers) => Promise<Buffer>;

const registry: Record<string, ThemeGenerator> = {
  veltrix: veltrix.generate,
  halloween: halloween.generate,
  christmas: christmas.generate,
  newyear: newyear.generate,
  garou: garou.generate,
  alucard: alucard.generate,
  moon: moon.generate,
  mahoraga: mahoraga.generate,
  obsidian: obsidian.generate,
  impact: impact.generate,
  static: staticTheme.generate,
  skyline: skyline.generate,
  reach: reach.generate,
  spiderman: spiderman.generate,
  comic: comic.generate,
  aether: aether.generate,
  nature: nature.generate,
  gojo: gojo.generate,
};

export function resolveTheme(name?: string): ThemeGenerator {
  if (!name) return registry['veltrix'];
  const key = name.toLowerCase();
  return registry[key] || registry['veltrix'];
}

export const themes = Object.keys(registry);