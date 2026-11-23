import { h, VNode } from '../renderer';
import { MEDIUM, SEMIBOLD, text } from '../theme';
import { staticImageDataUrl } from '../assets';

export type ScoreTemplatePlayer = {
  username: string;
  avatar: string;
  kills: number;
  deaths: number;
  kdr: string;
  diamonds: number;
  emeralds: number;
  eloBefore: number;
  eloAfter: number;
  mvp: boolean;
  bedbreaker: boolean;
  partyId?: string;
};

export type ScoreTemplateInput = {
  gameId: number;
  winners: ScoreTemplatePlayer[];
  losers: ScoreTemplatePlayer[];
  map: string;
  date: string;
  scoredAt: string;
  duration: string;
  mode: string;
  serverName: string;
  inviteLink: string;
};

const WIDTH = 1920;
const HEIGHT = 980;
const X = 60;
const W = WIDTH - X * 2;
const HEADER_H = 56;
const ROW_H = 60;
const WIN_TOP = 100;
const LOSE_TOP = 420;
const META_TOP = 740;

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
  purpleSoft: '#A855F7',
  white: '#FFFFFF',
  green: '#1E9E5A',
  red: '#D7263D',
  blue: '#1F8FBF',
  gold: '#C99A2E',
};

const ICONS = {
  arrowUp: 'M200,64V168a8,8,0,0,1-16,0V92.69L72.49,204.2a8,8,0,0,1-11.32-11.32L172.69,81.36H96a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z',
  arrowDown: 'M200,192a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h76.69L61.17,72.49A8,8,0,0,1,72.49,61.17L184,172.69V96a8,8,0,0,1,16,0Z',
  star: 'M152 70.059 L201.539 20.519 L235.48 54.461 L185.941 104 L256 104 L256 152 L185.941 152 L235.48 201.539 L201.539 235.48 L152 185.941 L152 256 L104 256 L104 185.941 L54.46 235.48 L20.52 201.539 L70.059 152 L0 152 L0 104 L70.059 104 L20.519 54.46 L54.461 20.52 L104 70.059 L104 0 L152 0 Z',
};

const COL = {
  kills: 900,
  deaths: 1010,
  kdr: 1120,
  dia: 1210,
  ems: 1300,
  eloX: 1470,
  eloW: 350,
};

const PARTY_COLORS = ['#7C3AED', '#0EA5E9', '#F59E0B', '#EC4899', '#10B981', '#EF4444'];

function icon(path: string, size: number, color: string): VNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 256 256', fill: color, style: { display: 'block' } },
    h('path', { d: path }),
  );
}

function kdColor(kdr: string): string {
  const value = Number(kdr);
  if (!Number.isFinite(value)) return C.faint;
  if (value > 1) return C.green;
  if (value < 1) return C.red;
  return C.faint;
}

function badge(label: string, color: string, background: string, border: string): VNode {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 6,
      backgroundColor: background,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: border,
    },
  },
    h('div', {
      style: { fontFamily: SEMIBOLD, fontSize: 18, letterSpacing: 1.2, lineHeight: '22px', color },
    }, label),
  );
}

function nameCell(player: ScoreTemplatePlayer, top: number): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: 136,
      top,
      width: 720,
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
        fontSize: 34,
        letterSpacing: -0.6,
        lineHeight: '40px',
        color: C.ink,
        whiteSpace: 'nowrap',
      },
    }, player.username),
    player.mvp ? badge('MVP', C.gold, '#FFF6DA', '#E7C96B') : null,
    player.bedbreaker ? badge('BED', C.purple, '#F3E8FF', '#C4B5FD') : null,
  );
}

function statsCells(player: ScoreTemplatePlayer, top: number): VNode[] {
  const cellText = (value: string, center: number, color: string) =>
    text(center - 60, top, 120, ROW_H, value, 32, color, SEMIBOLD, 'center', 0);

  return [
    cellText(String(player.kills), COL.kills, C.ink),
    cellText(String(player.deaths), COL.deaths, C.ink),
    cellText(player.kdr, COL.kdr, kdColor(player.kdr)),
    cellText(String(player.diamonds), COL.dia, C.blue),
    cellText(String(player.emeralds), COL.ems, C.green),
  ];
}

function eloCell(player: ScoreTemplatePlayer, top: number): VNode {
  const delta = player.eloAfter - player.eloBefore;
  const color = delta >= 0 ? C.green : C.red;
  const arrow = delta >= 0 ? ICONS.arrowUp : ICONS.arrowDown;

  return h('div', {
    style: {
      position: 'absolute',
      left: COL.eloX,
      top,
      width: COL.eloW,
      height: ROW_H,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 9,
    },
  },
    h('div', {
      style: { fontFamily: MEDIUM, fontSize: 26, letterSpacing: 0.2, lineHeight: '30px', color: C.mute },
    }, `${player.eloBefore} -> ${player.eloAfter}`),
    icon(arrow, 15, color),
    h('div', {
      style: { fontFamily: SEMIBOLD, fontSize: 26, letterSpacing: 0, lineHeight: '30px', color },
    }, String(Math.abs(delta))),
  );
}

function row(player: ScoreTemplatePlayer, index: number, top: number, partyColor?: string): VNode[] {
  const background = index % 2 === 0 ? C.rowA : C.rowB;

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
    partyColor
      ? h('div', {
        style: {
          position: 'absolute',
          left: 72,
          top: top + 10,
          width: 4,
          height: 40,
          borderRadius: 2,
          backgroundColor: partyColor,
        },
      })
      : null,
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
    nameCell(player, top),
    ...statsCells(player, top),
    eloCell(player, top),
  ].filter(Boolean) as VNode[];
}

function header(title: string, top: number, lineColor: string, labels: string[]): VNode[] {
  const labelX = [COL.kills, COL.deaths, COL.kdr, COL.dia, COL.ems];

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
        backgroundColor: lineColor,
      },
    }),
    text(80, top, 600, HEADER_H, title, 22, C.white, SEMIBOLD, 'left', 2.2),
    ...labels.slice(0, 6).flatMap((label, index) => [
      text(labelX[index] - 70, top, 140, HEADER_H, label, 16, C.white, SEMIBOLD, 'center', 1.6),
    ]),
    text(COL.eloX, top, COL.eloW, HEADER_H, 'ELO CHANGE', 16, C.white, SEMIBOLD, 'right', 1.6),
  ];
}

function section(
  players: ScoreTemplatePlayer[],
  top: number,
  title: string,
  teamColor: string,
  partyColors: Map<string, string>,
): VNode[] {
  const labels = ['KILLS', 'DEATHS', 'K/D', 'DIA', 'EMS'];

  return [
    ...header(title, top, teamColor, labels),
    ...Array.from({ length: 4 }, (_, index) => {
      const player = players[index];
      if (!player) return [];
      const partyColor = player.partyId ? partyColors.get(player.partyId) : undefined;
      return row(player, index, top + HEADER_H + index * ROW_H, partyColor);
    }).flat(),
  ];
}

function metaCell(label: string, value: string, x: number, width: number): VNode[] {
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: x + 18,
        top: META_TOP + 23,
        width: 10,
        height: 10,
      },
    }, icon(ICONS.star, 10, C.purple)),
    text(x + 34, META_TOP, width - 42, HEADER_H, label, 16, C.white, SEMIBOLD, 'left', 1.8),
    text(x + 20, META_TOP + HEADER_H, width - 40, ROW_H, value, 32, C.ink, SEMIBOLD, 'left', 0),
  ];
}

function metadata(input: ScoreTemplateInput): VNode[] {
  const columns: Array<{ label: string; value: string; x: number; width: number }> = [
    { label: 'MAP', value: input.map, x: X, width: 360 },
    { label: 'GAME ID', value: String(input.gameId), x: 420, width: 240 },
    { label: 'DATE', value: input.date, x: 660, width: 300 },
    { label: 'SCORED AT', value: input.scoredAt, x: 960, width: 300 },
    { label: 'DURATION', value: input.duration, x: 1260, width: 300 },
    { label: 'MODE', value: input.mode, x: 1560, width: 300 },
  ];

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: META_TOP,
        width: W,
        height: HEADER_H,
        backgroundColor: C.header,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: META_TOP + HEADER_H,
        width: W,
        height: ROW_H,
        backgroundColor: C.rowA,
        borderBottomWidth: 1,
        borderBottomColor: C.line,
      },
    }),
    ...columns.flatMap(column => metaCell(column.label, column.value, column.x, column.width)),
    ...columns.slice(1).flatMap(column => [
      h('div', {
        style: {
          position: 'absolute',
          left: column.x,
          top: META_TOP + HEADER_H,
          width: 1,
          height: ROW_H,
          backgroundColor: C.line,
        },
      }),
    ]),
    h('div', {
      style: {
        position: 'absolute',
        left: X,
        top: META_TOP + HEADER_H - 2,
        width: W,
        height: 2,
        backgroundColor: C.headerLine,
      },
    }),
  ];
}

export function scoreTemplate(input: ScoreTemplateInput): { root: VNode; width: number; height: number } {
  const partyCounts = new Map<string, number>();
  for (const player of [...input.winners, ...input.losers]) {
    if (!player.partyId) continue;
    partyCounts.set(player.partyId, (partyCounts.get(player.partyId) ?? 0) + 1);
  }
  const partyColors = new Map<string, string>();
  let partyIndex = 0;
  for (const [partyId, count] of partyCounts) {
    if (count < 2) continue;
    partyColors.set(partyId, PARTY_COLORS[partyIndex % PARTY_COLORS.length]);
    partyIndex += 1;
  }

  const root = h('div', {
    style: {
      display: 'flex',
      position: 'relative',
      width: WIDTH,
      height: HEIGHT,
      overflow: 'hidden',
      backgroundColor: C.bgBottom,
      backgroundImage: `linear-gradient(160deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`,
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
    ...section(input.winners, WIN_TOP, 'WINNERS', C.purple, partyColors),
    ...section(input.losers, LOSE_TOP, 'LOSERS', C.purpleSoft, partyColors),
    ...metadata(input),
    text(X, 916, 700, 28, input.serverName, 20, C.mute, SEMIBOLD, 'left', 1.4),
    text(WIDTH - X - 700, 916, 700, 28, input.inviteLink, 20, C.faint, SEMIBOLD, 'right', 1.4),
  );

  return { root, width: WIDTH, height: HEIGHT };
}




