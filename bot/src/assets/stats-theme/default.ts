import { h, VNode } from '../renderer';
import {
  accent,
  badge,
  COLORS,
  decor,
  divider,
  FONT,
  MEDIUM,
  panel,
  rootStyle,
  sectionLabel,
  text,
} from '../theme';

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

const RANK_TEXT = COLORS.purple;
const RANK_BG = 'rgba(167,139,250,0.10)';
const RANK_BORDER = 'rgba(167,139,250,0.32)';

function header(): VNode {
  return h('div', {},
    h('div', {
      style: {
        position: 'absolute',
        left: 60,
        top: 23,
        width: 10,
        height: 10,
        borderRadius: 3,
        backgroundColor: COLORS.cyan,
      },
    }),
    text(79, 16, 220, 24, 'RANKED BEDWARS', 14, COLORS.text, MEDIUM, 'left', 1.4),
    text(242, 18, 260, 22, 'PLAYER STATISTICS', 11, COLORS.muted, MEDIUM, 'left', 2),
    text(1040, 18, 300, 22, 'PROFILE CARD', 11, COLORS.faint, MEDIUM, 'right', 2),
  );
}

function hero(input: DefaultTemplateInput): VNode {
  const progress = Math.max(0, Math.min(1, input.xpProgress));

  return h('div', {},
    panel(60, 54, 1280, 230, 20),

    accent(60, 54, 4, 230, COLORS.cyan, 4),

    // Skin frame
    h('div', {
      style: {
        position: 'absolute',
        left: 92,
        top: 84,
        width: 148,
        height: 148,
        borderRadius: 18,
        backgroundColor: COLORS.panelRaised,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: COLORS.line,
        overflow: 'hidden',
      },
    },
      input.skin
        ? h('img', {
            src: input.skin,
            width: 148,
            height: 355,
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
            },
          })
        : null,
    ),

    badge(270, 78, 132, 'PLAYER PROFILE', {
      color: COLORS.cyan,
      background: 'rgba(77,225,242,0.08)',
      border: 'rgba(77,225,242,0.28)',
      height: 28,
      size: 12,
      letterSpacing: 1.2,
    }),

    text(
      270, 114, 600, 62,
      input.ign,
      input.ign.length > 14 ? 42 : 54,
      COLORS.text,
      MEDIUM,
       'left',
       0.4,
    ),

    text(272, 180, 520, 24, input.joined, 15, COLORS.muted),

    // Level progress
    sectionLabel(270, 212, 'LEVEL PROGRESS', COLORS.muted, COLORS.cyan),
    text(270, 236, 180, 24, `LEVEL ${input.level}`, 16, COLORS.cyan, MEDIUM),
    text(
      660, 238, 190, 22,
      `${input.xpToNext.toLocaleString()} XP TO NEXT`,
      12, COLORS.muted, FONT, 'right',
    ),

    h('div', {
      style: {
        position: 'absolute',
        left: 270,
        top: 266,
        width: 580,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#22303e',
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

    // Rating area
    divider(940, 86, 1, COLORS.line, 166),

    text(990, 94, 280, 22, 'COMPETITIVE RATING', 12, COLORS.muted, MEDIUM, 'left', 1.4),
    text(
      990, 122, 280, 70,
      `${input.elo.toLocaleString()} RR`,
      58, COLORS.cyan, MEDIUM,
    ),
    text(990, 202, 280, 20, 'GLOBAL RANK', 11, COLORS.muted, MEDIUM, 'left', 1.4),
    text(990, 222, 280, 32, `#${input.globalRank}`, 26, COLORS.text, MEDIUM),
  );
}

function record(input: DefaultTemplateInput): VNode {
  const winRate = Math.max(0, Math.min(1, input.winRate));

  return h('div', {},
    panel(60, 310, 1280, 150, 18),

    sectionLabel(88, 330, 'RECORD', COLORS.muted, COLORS.cyan),
    text(170, 330, 220, 20, 'LIFETIME', 11, COLORS.faint, MEDIUM, 'left', 1.6),

    divider(340, 354, 1, COLORS.line, 88),
    divider(1060, 354, 1, COLORS.line, 88),

    // Wins
    text(88, 358, 230, 60, input.wins, 50, COLORS.green, MEDIUM),
    text(88, 420, 180, 22, 'TOTAL WINS', 12, COLORS.muted, FONT, 'left', 1),

    // Losses
    text(1070, 358, 200, 60, input.losses, 50, COLORS.red, MEDIUM, 'right'),
    text(1070, 420, 200, 22, 'TOTAL LOSSES', 12, COLORS.muted, FONT, 'right', 1),

    // Win rate
    text(
      360, 338, 680, 46,
      `${(winRate * 100).toFixed(1)}%`,
      38, COLORS.text, MEDIUM, 'center',
    ),
    text(360, 386, 680, 22, 'WIN RATE', 12, COLORS.muted, MEDIUM, 'center', 1.4),

    h('div', {
      style: {
        position: 'absolute',
        left: 390,
        top: 424,
        width: 620,
        height: 7,
        borderRadius: 4,
        backgroundColor: COLORS.red,
        overflow: 'hidden',
      },
    },
      h('div', {
        style: {
          width: `${winRate * 100}%`,
          height: 7,
          backgroundColor: COLORS.green,
          borderRadius: 4,
        },
      }),
    ),

    text(390, 438, 620, 18, input.winCaption, 11, COLORS.muted, FONT, 'center'),
  );
}

function statTile(x: number, y: number, t: DefaultTile): VNode {
  return h('div', {},
    panel(x, y, 300, 118, 16),

    accent(x + 18, y + 18, 3, 82, t.accent || COLORS.cyan),

    text(x + 34, y + 14, 244, 54, t.value, 38, COLORS.text, MEDIUM),

    text(
      x + 34, y + 74, 232, 22,
      t.label,
      12, COLORS.muted, FONT, 'left', 0.9,
    ),

    badge(x + 216, y + 16, 66, t.rank || '-', {
      color: RANK_TEXT,
      background: RANK_BG,
      border: RANK_BORDER,
      height: 26,
      size: 12,
    }),
  );
}

function stats(input: DefaultTemplateInput): VNode {
  const xs = [60, 386, 712, 1038];
  const ys = [486, 616];

  return h('div', {},
    sectionLabel(60, 464, 'PERFORMANCE', COLORS.muted, COLORS.cyan),
    text(1040, 466, 300, 20, 'SEASON TOTALS', 11, COLORS.faint, MEDIUM, 'right', 1.6),

    ...input.tiles.slice(0, 8).map((t, i) =>
      statTile(xs[i % 4], ys[Math.floor(i / 4)], t),
    ),
  );
}

function combat(input: DefaultTemplateInput): VNode {
  const positions = [110, 510, 910];

  return h('div', {},
    panel(60, 755, 1280, 105, 18),

    sectionLabel(84, 768, 'COMBAT', COLORS.muted, COLORS.cyan),

    ...positions.map((x, i) => {
      const t = input.combat[i] || {
        value: '-',
        label: '',
        rank: '',
        accent: COLORS.cyan,
      };

      return h('div', {},
        accent(x, 796, 3, 40, t.accent || COLORS.cyan),

        text(x + 14, 794, 120, 44, t.value, 30, COLORS.text, MEDIUM),
        text(x + 140, 802, 160, 28, t.label, 13, COLORS.muted),
        badge(x + 292, 800, 65, t.rank || '-', {
          color: RANK_TEXT,
          background: RANK_BG,
          border: RANK_BORDER,
          height: 26,
          size: 12,
        }),

        i < 2 ? divider(x + 380, 796, 1, COLORS.line, 40) : null,
      );
    }),
  );
}

function footer(input: DefaultTemplateInput): VNode {
  return h('div', {},
    divider(60, 872, 1280, COLORS.line, 1),

    text(60, 884, 600, 20, input.seasonLine1, 12, COLORS.muted, MEDIUM, 'left', 1.2),
    text(60, 906, 760, 18, input.seasonLine2, 11, COLORS.faint),

    input.footerBrand
      ? text(940, 886, 400, 22, input.footerBrand, 12, COLORS.faint, MEDIUM, 'right', 0.6)
      : null,
  );
}

export function defaultTemplate(
  input: DefaultTemplateInput,
): { root: VNode; width: number; height: number } {
  const root = h('div', { style: rootStyle(WIDTH, HEIGHT) },
    decor(WIDTH, HEIGHT, 'stats'),

    header(),

    hero(input),
    record(input),
    stats(input),
    combat(input),
    footer(input),
  );

  return {
    root,
    width: WIDTH,
    height: HEIGHT,
  };
}
