import { h, VNode } from '../renderer';
import { MEDIUM, SEMIBOLD, text } from '../theme';
import { grainLayer } from '../grain';
import { DivisionTag, divisionTagBadge } from '../divisionTag';
import { AX, axPage } from '../themes/defaultTheme';

export type LeaderboardTemplateEntry = {
  rank: number;
  ign: string;
  value: string;
  avatar: string;
  rankName: string;
  rankColor: string;
  divisionTag?: DivisionTag | null;
};

export type LeaderboardTemplateInput = {
  title: string;
  categoryLabel: string;
  entries: LeaderboardTemplateEntry[];
  page: number;
  totalPages?: number;
  serverName: string;
  inviteLink: string;
};

const WIDTH = 1200;
const HEIGHT = 1080;
const X = 48;
const BOARD_W = WIDTH - X * 2;
const BOARD_TOP = 208;
const HEAD_H = 46;
const ROW_H = 72;
const ROWS = 10;
const ROWS_TOP = BOARD_TOP + HEAD_H;

const COL = {
  rank: X + 22,
  rankW: 54,
  avatar: X + 96,
  name: X + 154,
  nameW: 470,
  rankName: X + 660,
  rankNameW: 190,
  value: X + BOARD_W - 196,
  valueW: 176,
};

function slash(x: number, y: number, width: number, height: number, color: string): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
      backgroundColor: color,
      transform: 'skewX(-30deg)',
    },
  });
}

function avatar(entry: LeaderboardTemplateEntry, top: number): VNode {
  const accent = entry.rank <= 3 ? AX.accent : AX.line;
  return h('div', {
    style: {
      position: 'absolute',
      left: COL.avatar,
      top: top + 12,
      width: 48,
      height: 48,
      borderWidth: 2,
      borderStyle: 'solid',
      borderColor: accent,
      backgroundColor: AX.panel,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
    h('img', {
      src: entry.avatar,
      width: 44,
      height: 44,
      style: {
        width: 44,
        height: 44,
        objectFit: 'cover',
      },
    }),
  );
}

function row(entry: LeaderboardTemplateEntry, index: number): VNode[] {
  const top = ROWS_TOP + index * ROW_H;
  const background = index % 2 === 0 ? AX.paper : AX.paperDim;
  const rankLabel = String(entry.rank).padStart(2, '0');

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top,
        width: BOARD_W,
        height: ROW_H,
        backgroundColor: background,
        borderBottomWidth: 1,
        borderBottomColor: AX.lineSoft,
      },
    }),
    text(COL.rank, top, COL.rankW, ROW_H, rankLabel, 28, entry.rank <= 3 ? AX.accent : AX.ink, SEMIBOLD, 'left', 0),
    avatar(entry, top),
    h('div', {
      style: {
        position: 'absolute',
        left: COL.name,
        top,
        width: COL.nameW,
        height: ROW_H,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      },
    },
      h('div', {
        style: {
          fontFamily: SEMIBOLD,
          fontSize: 27,
          letterSpacing: -0.4,
          lineHeight: '32px',
          color: AX.ink,
          whiteSpace: 'nowrap',
        },
      }, entry.ign),
      divisionTagBadge(entry.divisionTag, 13),
    ),
    h('div', {
      style: {
        position: 'absolute',
        left: COL.rankName,
        top,
        width: COL.rankNameW,
        height: ROW_H,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
      },
    },
      h('div', {
        style: {
          width: 9,
          height: 9,
          backgroundColor: entry.rankColor,
          transform: 'rotate(45deg)',
        },
      }),
      h('div', {
        style: {
          fontFamily: MEDIUM,
          fontSize: 14,
          letterSpacing: 1.5,
          lineHeight: '18px',
          color: AX.mute,
          whiteSpace: 'nowrap',
        },
      }, entry.rankName.toUpperCase()),
    ),
    text(COL.value, top, COL.valueW, ROW_H, entry.value, 30, AX.accentDeep, SEMIBOLD, 'right', 0),
  ].filter(Boolean) as VNode[];
}

function headerRow(): VNode[] {
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: BOARD_TOP - 3,
        width: BOARD_W,
        height: 3,
        backgroundColor: AX.accent,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: BOARD_TOP,
        width: BOARD_W,
        height: HEAD_H,
        backgroundColor: AX.block,
      },
    }),
    text(COL.rank, BOARD_TOP, COL.rankW, HEAD_H, '#', 18, AX.blockMute, SEMIBOLD, 'left', 1.4),
    text(COL.name, BOARD_TOP, 300, HEAD_H, 'PLAYER', 18, AX.blockText, SEMIBOLD, 'left', 1.4),
    text(COL.rankName, BOARD_TOP, COL.rankNameW, HEAD_H, 'RANK', 18, AX.blockText, SEMIBOLD, 'left', 1.4),
    text(COL.value - 120, BOARD_TOP, COL.valueW + 120, HEAD_H, 'ELO', 18, AX.blockText, SEMIBOLD, 'right', 1.4),
  ];
}

function standings(input: LeaderboardTemplateInput): VNode[] {
  const pageLabel = input.totalPages && input.totalPages > 1
    ? `PAGE ${input.page + 1}/${input.totalPages}`
    : 'SEASON 01';

  return [
    text(X, 48, 460, 96, 'TOP 10', 84, 'rgba(255, 228, 242, 0.24)', SEMIBOLD, 'left', -2),
    text(WIDTH - X - 300, 52, 300, 120, '01', 104, 'rgba(248, 243, 255, 0.08)', SEMIBOLD, 'right', 0),
    slash(X + 360, 82, 24, 7, AX.accentSoft),
    text(X + 400, 70, 420, 18, 'SEASON STANDINGS', 13, AX.blockMute, SEMIBOLD, 'left', 2.2),
    text(X + 360, 92, 700, 36, input.title.toUpperCase(), 30, AX.blockText, SEMIBOLD, 'left', -0.6),
    text(X + 360, 130, 700, 20, `RANKED BY ${input.categoryLabel.toUpperCase()}  /  LIVE FROM THE BOARD`, 12, AX.blockMute, MEDIUM, 'left', 1.6),
    h('div', {
      style: {
        position: 'absolute',
        right: X,
        top: 94,
        height: 34,
        paddingLeft: 14,
        paddingRight: 14,
        backgroundColor: AX.block,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: AX.blockLine,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      },
    },
      h('div', { style: { width: 14, height: 5, backgroundColor: AX.accent, transform: 'skewX(-30deg)' } }),
      h('div', {
        style: {
          fontFamily: SEMIBOLD,
          fontSize: 11,
          letterSpacing: 2,
          lineHeight: '14px',
          color: AX.blockText,
        },
      }, pageLabel),
    ),
  ];
}

function footer(input: LeaderboardTemplateInput): VNode[] {
  const pageLabel = input.totalPages && input.totalPages > 1
    ? `PAGE ${input.page + 1}/${input.totalPages}`
    : '';
  const inviteLabel = input.inviteLink.includes('.gg/')
    ? input.inviteLink.slice(input.inviteLink.lastIndexOf('.gg/'))
    : input.inviteLink;
  const buttonW = 236;
  const buttonX = X + BOARD_W - buttonW;

  return [
    h('svg', {
      width: BOARD_W,
      height: 48,
      style: { position: 'absolute', left: X, top: 984 },
    }, h('path', { d: `M0 0 H${BOARD_W} L${BOARD_W - 10.67} 48 H0 Z`, fill: AX.block })),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: 984,
        width: 4,
        height: 48,
        backgroundColor: AX.accent,
      },
    }),
    text(X + 20, 984, 460, 48, input.serverName, 20, AX.blockText, SEMIBOLD, 'left', 1.4),
    text(X + 380, 984, 340, 48, [input.title.toUpperCase(), pageLabel].filter(Boolean).join('  /  '), 14, AX.blockMute, MEDIUM, 'center', 1.4),
    h('svg', {
      width: buttonW,
      height: 36,
      style: { position: 'absolute', left: buttonX, top: 990 },
    }, h('path', { d: `M8 0 H${buttonW} L${buttonW - 8} 36 H0 Z`, fill: AX.accent })),
    text(buttonX + 6, 990, buttonW - 12, 36, inviteLabel, 15, AX.white, SEMIBOLD, 'center', 1.2),
  ];
}

function avatarOverlay(entries: LeaderboardTemplateEntry[]): VNode[] {
  return entries.slice(0, ROWS).map((entry, index) => avatar(entry, ROWS_TOP + index * ROW_H));
}

export function leaderboardTemplate(input: LeaderboardTemplateInput): { root: VNode; width: number; height: number } {
  const root = h('div', {
    style: {
      display: 'flex',
      position: 'relative',
      width: WIDTH,
      height: HEIGHT,
      overflow: 'hidden',
      backgroundColor: AX.pageBottom,
    },
  },
    ...axPage(WIDTH, HEIGHT),
    ...standings(input),
    ...headerRow(),
    ...Array.from({ length: ROWS }, (_, index) => {
      const entry = input.entries[index];
      if (!entry) return [];
      return row(entry, index);
    }).flat(),
    ...footer(input),
    grainLayer(WIDTH, HEIGHT, 0.16),
    ...avatarOverlay(input.entries),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
