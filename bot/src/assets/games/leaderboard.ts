import { h, VNode } from '../renderer';
import { SEMIBOLD, text } from '../theme';
import { staticImageDataUrl } from '../assets';

export type LeaderboardTemplateEntry = {
  rank: number;
  ign: string;
  value: string;
  avatar: string;
  rankName: string;
  rankColor: string;
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
const X = 40;
const W = WIDTH - X * 2;
const HEADER_H = 60;
const ROW_H = 88;
const ROWS = 10;

const C = {
  bgTop: '#E3E5E9',
  bgBottom: '#CFD2D8',
  ink: '#14161A',
  mute: '#5E6470',
  faint: '#8A909B',
  line: '#C2C6CE',
  rowA: '#EDEFF3',
  rowB: '#F8F9FB',
  header: '#16181D',
  headerLine: '#7C3AED',
  purple: '#7C3AED',
  white: '#FFFFFF',
};

function header(categoryLabel: string): VNode[] {
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: 40,
        width: W,
        height: HEADER_H,
        backgroundColor: C.header,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: 40 + HEADER_H - 2,
        width: W,
        height: 2,
        backgroundColor: C.headerLine,
      },
    }),
    text(60, 40, 80, HEADER_H, '#', 18, C.white, SEMIBOLD, 'left', 1.6),
    text(170, 40, 500, HEADER_H, 'PLAYER', 18, C.white, SEMIBOLD, 'left', 1.6),
    text(780, 40, 300, HEADER_H, 'RANK', 18, C.white, SEMIBOLD, 'left', 1.6),
    text(980, 40, 160, HEADER_H, categoryLabel.toUpperCase(), 18, C.white, SEMIBOLD, 'right', 1.6),
  ];
}

function row(entry: LeaderboardTemplateEntry, index: number): VNode[] {
  const top = 40 + HEADER_H + index * ROW_H;
  const background = index % 2 === 0 ? C.rowA : C.rowB;
  const rankLabel = String(entry.rank).padStart(2, '0');

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top,
        width: W,
        height: ROW_H,
        backgroundColor: background,
        borderBottomWidth: 1,
        borderBottomColor: C.line,
      },
    }),
    text(60, top, 80, ROW_H, rankLabel, 30, C.purple, SEMIBOLD, 'left', 0),
    h('img', {
      src: entry.avatar,
      width: 56,
      height: 56,
      style: {
        position: 'absolute',
        left: 160,
        top: top + 16,
        width: 56,
        height: 56,
        borderRadius: 8,
        objectFit: 'cover',
      },
    }),
    text(232, top, 520, ROW_H, entry.ign, 28, C.ink, SEMIBOLD, 'left', -0.2),
    text(790, top, 190, ROW_H, entry.rankName.toUpperCase(), 20, C.mute, SEMIBOLD, 'left', 1.2),
    text(980, top, 160, ROW_H, entry.value, 30, C.purple, SEMIBOLD, 'right', 0),
  ];
}

function footer(input: LeaderboardTemplateInput): VNode[] {
  const pageLabel = input.totalPages && input.totalPages > 1
    ? `PAGE ${input.page + 1}/${input.totalPages}`
    : '';
  return [
    text(X, 1016, 620, 28, input.serverName, 18, C.mute, SEMIBOLD, 'left', 1.4),
    text(WIDTH - X - 620, 1016, 620, 28, [input.title.toUpperCase(), pageLabel].filter(Boolean).join('  ·  '), 16, C.faint, SEMIBOLD, 'right', 1.4),
  ];
}

export function leaderboardTemplate(input: LeaderboardTemplateInput): { root: VNode; width: number; height: number } {
  const root = h('div', {
    style: {
      display: 'flex',
      position: 'relative',
      width: WIDTH,
      height: HEIGHT,
      overflow: 'hidden',
      backgroundColor: C.bgBottom,
    },
  },
    h('img', {
      src: staticImageDataUrl('backgrounds', 'halftone.png'),
      width: WIDTH,
      height: HEIGHT,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: WIDTH,
        height: HEIGHT,
        objectFit: 'cover',
      },
    }),
    h('img', {
      src: staticImageDataUrl('backgrounds', 'grain.png'),
      width: WIDTH,
      height: HEIGHT,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: WIDTH,
        height: HEIGHT,
        objectFit: 'cover',
        opacity: 0.12,
      },
    }),
    ...header(input.categoryLabel),
    ...Array.from({ length: ROWS }, (_, index) => {
      const entry = input.entries[index];
      if (!entry) return [];
      return row(entry, index);
    }).flat(),
    ...footer(input),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
