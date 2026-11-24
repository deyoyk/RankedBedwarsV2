import { h, VNode } from '../renderer';
import { SEMIBOLD, text } from '../theme';
import { staticImageDataUrl } from '../assets';
import { grainLayer } from '../grain';
import { DivisionTag, divisionTagBadge } from '../divisionTag';

export type StartTemplatePlayer = {
  username: string;
  elo: number;
  isCaptain: boolean;
  avatar: string;
  divisionTag?: DivisionTag | null;
};

export type StartTemplateInput = {
  gameId: number;
  mapName: string;
  modeLabel: string;
  team1: StartTemplatePlayer[];
  team2: StartTemplatePlayer[];
  team1Avg: number;
  team2Avg: number;
  isRanked?: boolean;
  minElo?: number;
  maxElo?: number;
  serverName: string;
  inviteLink: string;
};

const WIDTH = 1920;
const HEIGHT = 980;
const X = 60;
const W = WIDTH - X * 2;
const HEADER_H = 56;
const INFO_ROW_H = 70;
const ROW_H = 60;
const INFO_TOP = 100;
const GREEN_TOP = 250;
const RED_TOP = 570;

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
  green: '#1E9E5A',
  red: '#D7263D',
  white: '#FFFFFF',
};

const ICONS = {
  star: 'M152 70.059 L201.539 20.519 L235.48 54.461 L185.941 104 L256 104 L256 152 L185.941 152 L235.48 201.539 L201.539 235.48 L152 185.941 L152 256 L104 256 L104 185.941 L54.46 235.48 L20.52 201.539 L70.059 152 L0 152 L0 104 L70.059 104 L20.519 54.46 L54.461 20.52 L104 70.059 L104 0 L152 0 Z',
};

function icon(path: string, size: number, color: string): VNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 256 256', fill: color, style: { display: 'block' } },
    h('path', { d: path }),
  );
}

function rowBase(top: number, height: number, alternate: boolean): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: X,
      top,
      width: W,
      height,
      backgroundColor: alternate ? C.rowB : C.rowA,
      borderBottomWidth: 1,
      borderBottomColor: C.line,
    },
  });
}

function header(title: string, top: number, teamColor: string, avg: number): VNode[] {
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top,
        width: W,
        height: HEADER_H,
        backgroundColor: C.header,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: top + HEADER_H - 2,
        width: W,
        height: 2,
        backgroundColor: C.headerLine,
      },
    }),
    text(80, top, 700, HEADER_H, title, 22, teamColor, SEMIBOLD, 'left', 2),
    text(WIDTH - X - 430, top, 400, HEADER_H, `AVG ${avg}`, 18, C.white, SEMIBOLD, 'right', 1.4),
  ];
}

function infoHeader(): VNode[] {
  const columns = [
    { label: 'GAME ID', x: 760, width: 300 },
    { label: 'MODE', x: 1160, width: 300 },
    { label: 'QUEUE', x: 1500, width: 300 },
  ];

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: INFO_TOP,
        width: W,
        height: HEADER_H,
        backgroundColor: C.header,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: INFO_TOP + HEADER_H - 2,
        width: W,
        height: 2,
        backgroundColor: C.headerLine,
      },
    }),
    text(80, INFO_TOP, 600, HEADER_H, 'MATCH START', 22, C.white, SEMIBOLD, 'left', 2.2),
    ...columns.flatMap(column => [
      h('div', {
        style: {
          position: 'absolute',
          left: column.x,
          top: INFO_TOP + 23,
          width: 10,
          height: 10,
        },
      }, icon(ICONS.star, 10, C.purple)),
      text(column.x + 16, INFO_TOP, column.width - 20, HEADER_H, column.label, 16, C.white, SEMIBOLD, 'left', 1.8),
    ]),
  ];
}

function infoRow(input: StartTemplateInput): VNode[] {
  const top = INFO_TOP + HEADER_H;
  const queue = input.isRanked
    ? `${input.minElo ?? 0} - ${input.maxElo ?? 0}`
    : 'CASUAL';

  return [
    rowBase(top, INFO_ROW_H, false),
    text(80, top, 620, INFO_ROW_H, input.mapName, 32, C.ink, SEMIBOLD, 'left', 0),
    text(760, top, 300, INFO_ROW_H, `#${input.gameId}`, 32, C.ink, SEMIBOLD, 'left', 0),
    text(1160, top, 300, INFO_ROW_H, input.modeLabel, 32, C.ink, SEMIBOLD, 'left', 0),
    text(1500, top, 300, INFO_ROW_H, queue, 32, C.ink, SEMIBOLD, 'left', 0),
  ];
}

function playerRow(player: StartTemplatePlayer, top: number): VNode[] {
  return [
    h('img', {
      src: player.avatar,
      width: 40,
      height: 40,
      style: {
        position: 'absolute',
        left: 80,
        top: top + 10,
        width: 40,
        height: 40,
        borderRadius: 6,
        objectFit: 'cover',
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: 136,
        top,
        width: 700,
        height: ROW_H,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      },
    },
      h('div', {
        style: {
          fontFamily: SEMIBOLD,
          fontSize: 32,
          letterSpacing: -0.4,
          lineHeight: '38px',
          color: C.ink,
          whiteSpace: 'nowrap',
        },
      }, player.username),
      divisionTagBadge(player.divisionTag, 16),
      player.isCaptain
        ? h('div', {
          style: {
            paddingLeft: 10,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 3,
            borderRadius: 6,
            backgroundColor: '#F3E8FF',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: '#C4B5FD',
            fontFamily: SEMIBOLD,
            fontSize: 16,
            letterSpacing: 1.2,
            lineHeight: '20px',
            color: C.purple,
          },
        }, 'CPT')
        : null,
    ),
    text(WIDTH - X - 350, top, 320, ROW_H, String(player.elo), 32, C.ink, SEMIBOLD, 'right', 0),
  ].filter(Boolean) as VNode[];
}

function teamSection(
  players: StartTemplatePlayer[],
  top: number,
  title: string,
  teamColor: string,
  avg: number,
): VNode[] {
  return [
    ...header(title, top, teamColor, avg),
    ...Array.from({ length: 4 }, (_, index) => {
      const player = players[index];
      if (!player) return [];
      const rowTop = top + HEADER_H + index * ROW_H;
      return [
        rowBase(rowTop, ROW_H, index % 2 === 1),
        ...playerRow(player, rowTop),
      ];
    }).flat(),
  ];
}

function avatarOverlay(players: StartTemplatePlayer[], top: number): VNode[] {
  return players.slice(0, 4).map((player, index) => h('img', {
    src: player.avatar,
    width: 40,
    height: 40,
    style: {
      position: 'absolute',
      left: 80,
      top: top + HEADER_H + index * ROW_H + 10,
      width: 40,
      height: 40,
      borderRadius: 6,
      objectFit: 'cover',
    },
  }));
}

export function startTemplate(input: StartTemplateInput): { root: VNode; width: number; height: number } {
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
    ...infoHeader(),
    ...infoRow(input),
    ...teamSection(input.team1, GREEN_TOP, 'TEAM GREEN', C.green, input.team1Avg),
    ...teamSection(input.team2, RED_TOP, 'TEAM RED', C.red, input.team2Avg),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: 912,
        width: W,
        height: 44,
        borderRadius: 8,
        backgroundColor: 'rgba(12, 10, 18, 0.55)',
      },
    }),
    text(X + 20, 920, 700, 28, input.serverName, 20, '#FFFFFF', SEMIBOLD, 'left', 1.4),
    text(WIDTH - X - 720, 920, 700, 28, input.inviteLink, 20, '#E9D5FF', SEMIBOLD, 'right', 1.4),
    grainLayer(WIDTH, HEIGHT),
    ...avatarOverlay(input.team1, GREEN_TOP),
    ...avatarOverlay(input.team2, RED_TOP),
  );

  return { root, width: WIDTH, height: HEIGHT };
}

