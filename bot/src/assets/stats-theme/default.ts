
import { h, VNode } from '../renderer';
import {
  COLORS,
  FONT,
  MEDIUM,
  accent,
  badge,
  decor,
  divider,
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

const BG = '#0B0D12';
const CARD = '#11151C';
const CARD_INNER = '#151B24';
const LINE = '#252D38';

const CYAN = '#54E4F2';
const GREEN = '#5DE2A2';
const RED = '#FF647C';
const WHITE = '#F1F5F9';
const MUTED = '#8491A3';
const FAINT = '#566171';

const PURPLE = '#B69CFF';

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

function heading(
  x: number,
  y: number,
  label: string,
  detail?: string,
): VNode {
  return h('div', {},
    text(x, y, 500, 20, label.toUpperCase(), 13, MUTED, MEDIUM, 'left', 1.5),
    detail
      ? text(850, y, 490, 20, detail.toUpperCase(), 12, FAINT, FONT, 'right', 1.2)
      : null,
  );
}

function header(): VNode {
  return h('div', {},
    h('div', {
      style: {
        position: 'absolute',
        left: 60,
        top: 26,
        width: 8,
        height: 8,
        borderRadius: 2,
        backgroundColor: CYAN,
      },
    }),

    text(78, 18, 260, 24, 'RBW', 17, WHITE, MEDIUM, 'left', 1.5),
    text(130, 20, 300, 20, 'PLAYER PROFILE', 12, MUTED, FONT, 'left', 1.5),

    text(
      980, 20, 360, 20,
      'RANKED BEDWARS  /  STATISTICS',
      12, FAINT, FONT, 'right', 1.2,
    ),

    divider(60, 50, 1280, LINE, 1),
  );
}

function hero(input: DefaultTemplateInput): VNode {
  const progress = clamp(input.xpProgress, 0, 1);

  return h('div', {},
    panel(60, 70, 1280, 220, 20),

    // Left identity accent
    accent(60, 70, 3, 220, CYAN, 3),

    // Skin portrait
    h('div', {
      style: {
        position: 'absolute',
        left: 88,
        top: 96,
        width: 150,
        height: 150,
        borderRadius: 16,
        backgroundColor: CARD_INNER,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: LINE,
        overflow: 'hidden',
      },
    },
      input.skin
        ? h('img', {
            src: input.skin,
            width: 150,
            height: 360,
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
            },
          })
        : null,
    ),

    // Player identity
    badge(270, 94, 135, 'PLAYER', {
      color: CYAN,
      background: 'rgba(84,228,242,0.08)',
      border: 'rgba(84,228,242,0.2)',
      height: 28,
      size: 12,
      letterSpacing: 1,
    }),

    text(
      270, 132, 600, 58,
      input.ign,
      input.ign.length > 14 ? 38 : 48,
      WHITE, MEDIUM, 'left', 0,
    ),

    text(272, 190, 500, 22, input.joined, 14, MUTED),

    // XP progress
    text(270, 228, 180, 20, `LEVEL ${input.level}`, 15, CYAN, MEDIUM),

    text(
      630, 228, 220, 20,
      `${input.xpToNext.toLocaleString()} XP TO NEXT`,
      12, MUTED, FONT, 'right',
    ),

    h('div', {
      style: {
        position: 'absolute',
        left: 270,
        top: 256,
        width: 580,
        height: 5,
        borderRadius: 3,
        backgroundColor: '#26313D',
        overflow: 'hidden',
      },
    },
      h('div', {
        style: {
          width: `${progress * 100}%`,
          height: 5,
          backgroundColor: CYAN,
          borderRadius: 3,
        },
      }),
    ),

    // Competitive rating
    divider(900, 95, 1, LINE, 170),

    text(940, 102, 300, 20, 'COMPETITIVE RATING', 12, MUTED, MEDIUM, 'left', 1.3),

    text(
      940, 130, 340, 70,
      input.elo.toLocaleString(),
      64, CYAN, MEDIUM, 'left', -1,
    ),

    text(940, 205, 250, 20, 'RANKED RATING', 12, FAINT),

    badge(940, 238, 140, `#${input.globalRank}`, {
      color: PURPLE,
      background: 'rgba(182,156,255,0.08)',
      border: 'rgba(182,156,255,0.25)',
      height: 32,
      size: 16,
    }),
  );
}

function record(input: DefaultTemplateInput): VNode {
  const winRate = clamp(input.winRate, 0, 1);

  return h('div', {},
    panel(60, 310, 1280, 130, 18),

    heading(88, 330, 'Lifetime Record', 'All-Time Statistics'),

    divider(450, 354, 1, LINE, 62),
    divider(950, 354, 1, LINE, 62),

    // Wins
    text(88, 360, 300, 48, input.wins, 42, GREEN, MEDIUM),
    text(90, 410, 250, 18, 'TOTAL WINS', 12, MUTED, FONT, 'left', 1),

    // Win rate
    text(
      490, 358, 420, 48,
      `${(winRate * 100).toFixed(1)}%`,
      42, WHITE, MEDIUM, 'center',
    ),

    text(490, 408, 420, 18, 'WIN RATE', 12, MUTED, MEDIUM, 'center', 1),

    // Losses
    text(1000, 360, 280, 48, input.losses, 42, RED, MEDIUM, 'right'),
    text(1030, 410, 250, 18, 'TOTAL LOSSES', 12, MUTED, FONT, 'right', 1),
  );
}

function statTile(x: number, y: number, tile: DefaultTile): VNode {
  const color = tile.accent || CYAN;

  return h('div', {},
    panel(x, y, 300, 108, 14),

    accent(x + 18, y + 20, 3, 68, color, 3),

    text(
      x + 34, y + 15, 245, 48,
      tile.value,
      tile.value.length > 7 ? 32 : 38,
      WHITE, MEDIUM, 'left', -0.5,
    ),

    text(
      x + 34, y + 68, 240, 18,
      tile.label.toUpperCase(),
      12, MUTED, FONT, 'left', 0.8,
    ),

    tile.rank
      ? badge(x + 205, y + 12, 78, tile.rank, {
          color: PURPLE,
          background: 'rgba(182,156,255,0.07)',
          border: 'rgba(182,156,255,0.2)',
          height: 26,
          size: 12,
        })
      : null,
  );
}

function stats(input: DefaultTemplateInput): VNode {
  const xs = [60, 386, 712, 1038];
  const ys = [500, 620];

  return h('div', {},
    heading(60, 466, 'Performance', 'Season Statistics'),

    ...input.tiles.slice(0, 8).map((tile, i) =>
      statTile(
        xs[i % 4],
        ys[Math.floor(i / 4)],
        tile,
      ),
    ),
  );
}

function combat(input: DefaultTemplateInput): VNode {
  const positions = [90, 510, 930];

  return h('div', {},
    panel(60, 765, 1280, 100, 16),

    heading(84, 780, 'Combat', 'Combat Performance'),

    ...positions.map((x, i) => {
      const tile = input.combat[i] || {
        value: '-',
        label: '',
        rank: '',
        accent: CYAN,
      };

      return h('div', {},
        accent(x, 817, 3, 32, tile.accent || CYAN, 3),

        text(
          x + 14, 808, 125, 42,
          tile.value,
          34, WHITE, MEDIUM,
        ),

        text(
          x + 145, 817, 150, 24,
          tile.label.toUpperCase(),
          12, MUTED, FONT,
        ),

        tile.rank
          ? badge(x + 290, 813, 70, tile.rank, {
              color: PURPLE,
              background: 'rgba(182,156,255,0.08)',
              border: 'rgba(182,156,255,0.2)',
              height: 26,
              size: 12,
            })
          : null,

        i < 2
          ? divider(x + 390, 813, 1, LINE, 36)
          : null,
      );
    }),
  );
}

function footer(input: DefaultTemplateInput): VNode {
  return h('div', {},
    divider(60, 888, 1280, LINE, 1),

    text(
      60, 899, 600, 20,
      input.seasonLine1,
      12, MUTED, MEDIUM, 'left', 0.8,
    ),

    text(
      60, 920, 700, 16,
      input.seasonLine2,
      11, FAINT,
    ),

    input.footerBrand
      ? text(
          940, 902, 400, 20,
          input.footerBrand,
          12, FAINT, MEDIUM, 'right',
        )
      : null,
  );
}

export function defaultTemplate(
  input: DefaultTemplateInput,
): { root: VNode; width: number; height: number } {
  const root = h(
    'div',
    { style: rootStyle(WIDTH, HEIGHT) },

    decor(WIDTH, HEIGHT, 'stats'),

    // Background
    h('div', {
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: WIDTH,
        height: HEIGHT,
        backgroundColor: BG,
      },
    }),

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
