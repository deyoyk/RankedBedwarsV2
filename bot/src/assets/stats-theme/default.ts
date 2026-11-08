import { h, VNode } from '../renderer';
import { COLORS, FONT, MEDIUM, divider, rootStyle, text } from '../theme';

export type DefaultTile = {
  value: string;
  label: string;
  accent: string;
  rank: string;
};

export type DefaultTemplateInput = {
  ign: string;
  joined: string;
  level: number;
  xpToNext: number;
  xpProgress: number;
  skin: string | null;
  elo: number;
  globalRank: number | string;
  wins: string;
  losses: string;
  winRate: number;
  winCaption: string;
  tiles: DefaultTile[];
  combat: DefaultTile[];
  seasonLine1: string;
  seasonLine2: string;
  footerBrand: string;
};

const WIDTH = 1400;
const HEIGHT = 940;
const X = 72;
const W = WIDTH - X * 2;
const TILE_X = [72, 392, 712, 1032];
const TILE_W = 300;
const TILE_ROW_Y = [604, 688];
const GAME_STAT_X = [72, 287, 502, 717, 932, 1147];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sectionHeading(label: string, detail: string, y: number): VNode[] {
  return [
    text(X, y, 520, 22, label, 17, COLORS.cyan, MEDIUM, 'left', 1.2),
    text(WIDTH - X - 520, y + 2, 520, 20, detail, 13, COLORS.faint, MEDIUM, 'right', 1.1),
  ];
}

function skinPortrait(skin: string | null): VNode | null {
  if (!skin) return null;
  return h('img', {
    src: skin,
    width: 180,
    height: 180,
    style: {
      position: 'absolute',
      left: X,
      top: 104,
      width: 180,
      height: 180,
    },
  });
}

function statTile(tile: DefaultTile, x: number, y: number): VNode[] {
  return [
    text(x, y, TILE_W, 44, tile.value, 40, COLORS.text, MEDIUM, 'left', -0.4),
    tile.rank
      ? text(x + 176, y + 6, 124, 30, tile.rank, 22, COLORS.muted, MEDIUM, 'right', 0.4)
      : null,
    text(x, y + 48, TILE_W, 20, tile.label.toUpperCase(), 15, COLORS.muted, MEDIUM, 'left', 0.7),
  ].filter(Boolean) as VNode[];
}

function combatTile(tile: DefaultTile, x: number, y: number): VNode[] {
  return [
    text(x, y, 180, 40, tile.value, 34, COLORS.text, MEDIUM, 'left', -0.3),
    text(x, y + 40, 180, 18, tile.label.toUpperCase(), 15, COLORS.muted, MEDIUM, 'left', 0.7),
  ];
}

export function defaultTemplate(
  input: DefaultTemplateInput,
): { root: VNode; width: number; height: number } {
  const progress = clamp(input.xpProgress, 0, 1);
  const nameSize = input.ign.length > 14 ? 50 : 64;
  const seasonLine = [input.seasonLine1, input.seasonLine2].filter(Boolean).join(' · ');

  const root = h('div', { style: rootStyle(WIDTH, HEIGHT) },
    text(X, 34, 300, 28, 'RBW', 24, COLORS.text, MEDIUM, 'left', 1.2),
    text(X + 72, 38, 400, 22, 'PLAYER PROFILE', 15, COLORS.muted, FONT, 'left', 1.4),
    input.footerBrand
      ? text(WIDTH / 2 - 250, 38, 500, 22, input.footerBrand, 18, COLORS.muted, MEDIUM, 'center', 0.4)
      : null,
    text(WIDTH - X - 520, 38, 520, 22, 'RANKED BEDWARS', 15, COLORS.faint, MEDIUM, 'right', 1.4),
    divider(X, 72, W, COLORS.line, 1),

    skinPortrait(input.skin),

    text(X + 212, 143, 680, 74, input.ign, nameSize, COLORS.text, MEDIUM, 'left', 0),
    text(X + 214, 221, 680, 24, input.joined, 20, COLORS.muted, FONT, 'left', 0),

    text(WIDTH - X - 328, 104, 328, 18, 'ELO', 16, COLORS.muted, MEDIUM, 'right', 1.2),
    text(WIDTH - X - 328, 126, 328, 112, String(input.elo), 112, COLORS.cyan, MEDIUM, 'right', -2),
    text(WIDTH - X - 328, 246, 328, 18, 'GLOBAL RANK', 12, COLORS.muted, MEDIUM, 'right', 1.2),
    text(WIDTH - X - 328, 264, 328, 36, `#${input.globalRank}`, 32, COLORS.text, MEDIUM, 'right', 0),

    text(X, 292, 720, 20, seasonLine, 14, COLORS.muted, MEDIUM, 'left', 0.4),
    text(X, 320, 300, 26, `LEVEL ${input.level}`, 22, COLORS.cyan, MEDIUM, 'left', 0.4),
    text(WIDTH - X - 420, 324, 420, 22, `${input.xpToNext.toLocaleString()} XP TO NEXT`, 16, COLORS.muted, MEDIUM, 'right', 0.6),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: 356,
        width: W,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#1A2029',
        overflow: 'hidden',
      },
    },
      h('div', {
        style: {
          width: `${progress * 100}%`,
          height: 6,
          borderRadius: 3,
          backgroundColor: COLORS.cyan,
        },
      }),
    ),

    ...sectionHeading('LIFETIME RECORD', 'ALL-TIME STATISTICS', 404),
    divider(X, 434, W, COLORS.line, 1),
    text(X, 456, 300, 64, input.wins, 64, COLORS.green, MEDIUM, 'left', -1),
    text(X, 524, 300, 20, 'TOTAL WINS', 15, COLORS.muted, MEDIUM, 'left', 0.7),
    text(X + 448, 456, 300, 64, input.losses, 64, COLORS.red, MEDIUM, 'left', -1),
    text(X + 448, 524, 300, 20, 'TOTAL LOSSES', 15, COLORS.muted, MEDIUM, 'left', 0.7),
    text(X + 896, 456, 360, 64, `${(clamp(input.winRate, 0, 1) * 100).toFixed(1)}%`, 64, COLORS.text, MEDIUM, 'left', -1),
    text(X + 896, 524, 360, 20, 'WIN RATE', 15, COLORS.muted, MEDIUM, 'left', 0.7),

    ...sectionHeading('PERFORMANCE', 'SEASON STATISTICS', 560),
    divider(X, 588, W, COLORS.line, 1),
    ...input.tiles.slice(0, 8).flatMap((tile, index) =>
      statTile(tile, TILE_X[index % 4], TILE_ROW_Y[Math.floor(index / 4)]),
    ),

    ...sectionHeading('GAME STATS', 'MATCH TOTALS', 780),
    divider(X, 808, W, COLORS.line, 1),
    ...input.combat.slice(0, 6).flatMap((tile, index) =>
      combatTile(tile, GAME_STAT_X[index], 824),
    ),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
