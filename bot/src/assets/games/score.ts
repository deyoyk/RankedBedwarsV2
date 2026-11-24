import { h, VNode } from '../renderer';
import { MEDIUM, SEMIBOLD, text } from '../theme';
import { grainLayer } from '../grain';
import { DivisionTag, divisionTagBadge } from '../divisionTag';
import { AX, axBrackets, axPage, axStamp } from '../themes/defaultTheme';

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
  divisionTag?: DivisionTag | null;
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
const SHEET_X = 40;
const SHEET_Y = 40;
const SHEET_W = WIDTH - SHEET_X * 2;
const SHEET_H = HEIGHT - SHEET_Y * 2;
const PAD = 28;
const IX = SHEET_X + PAD;
const IW = SHEET_W - PAD * 2;
const SEC_HEAD = 46;
const ROW_H = 58;
const WIN_TOP = SHEET_Y + 138;
const WIN_ROWS = WIN_TOP + SEC_HEAD;
const LOSE_TOP = WIN_ROWS + 4 * ROW_H + 16;
const LOSE_ROWS = LOSE_TOP + SEC_HEAD;
const META_TOP = SHEET_Y + 760;
const META_HEAD = 42;
const META_ROW = 52;
const FOOT_TOP = SHEET_Y + 864;
const FOOT_H = 48;

const COL = {
  kills: 810,
  deaths: 960,
  kdr: 1110,
  dia: 1260,
  ems: 1390,
  eloX: IX + IW - 336,
  eloW: 300,
};

const ICONS = {
  arrowUp: 'M200,64V168a8,8,0,0,1-16,0V92.69L72.49,204.2a8,8,0,0,1-11.32-11.32L172.69,81.36H96a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z',
  arrowDown: 'M200,192a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h76.69L61.17,72.49A8,8,0,0,1,72.49,61.17L184,172.69V96a8,8,0,0,1,16,0Z',
};

const PARTY_COLORS = ['#DB2777', '#0EA5E9', '#F59E0B', '#EC4899', '#10B981', '#EF4444'];

function icon(path: string, size: number, color: string): VNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 256 256', fill: color, style: { display: 'block' } },
    h('path', { d: path }),
  );
}

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

function kdColor(kdr: string): string {
  const value = Number(kdr);
  if (!Number.isFinite(value)) return AX.mute;
  if (value > 1) return AX.win;
  if (value < 1) return AX.loss;
  return AX.mute;
}

function badge(label: string, color: string, background: string, border: string): VNode {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 9,
      paddingRight: 9,
      paddingTop: 3,
      paddingBottom: 3,
      borderRadius: 4,
      backgroundColor: background,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: border,
    },
  },
    h('div', {
      style: { fontFamily: SEMIBOLD, fontSize: 13, letterSpacing: 1.2, lineHeight: '16px', color },
    }, label),
  );
}

function avatar(player: ScoreTemplatePlayer, top: number, teamColor: string): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: IX + 12,
      top: top + 9,
      width: 40,
      height: 40,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: teamColor,
      backgroundColor: AX.panel,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
    h('img', {
      src: player.avatar,
      width: 36,
      height: 36,
      style: { width: 36, height: 36, objectFit: 'cover' },
    }),
  );
}

function row(player: ScoreTemplatePlayer, index: number, top: number, teamColor: string, partyColor?: string): VNode[] {
  const background = index % 2 === 0 ? AX.paper : AX.paperDim;
  const delta = player.eloAfter - player.eloBefore;
  const color = delta >= 0 ? AX.win : AX.loss;
  const arrow = delta >= 0 ? ICONS.arrowUp : ICONS.arrowDown;

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top,
        width: IW,
        height: ROW_H,
        backgroundColor: background,
        borderBottomWidth: 1,
        borderBottomColor: AX.lineSoft,
      },
    }),
    partyColor
      ? h('div', {
        style: {
          position: 'absolute',
          left: IX + 2,
          top: top + 9,
          width: 4,
          height: 40,
          backgroundColor: partyColor,
        },
      })
      : null,
    avatar(player, top, teamColor),
    h('div', {
      style: {
        position: 'absolute',
        left: IX + 62,
        top,
        width: 640,
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
          fontSize: 26,
          letterSpacing: -0.4,
          lineHeight: '32px',
          color: AX.ink,
          whiteSpace: 'nowrap',
        },
      }, player.username),
      divisionTagBadge(player.divisionTag, 13),
      player.mvp ? badge('MVP', '#8A5A00', '#FFF6DA', '#E7C96B') : null,
      player.bedbreaker ? badge('BED', AX.accentDeep, '#FCE7F3', '#F9A8D4') : null,
    ),
    text(COL.kills - 55, top, 110, ROW_H, String(player.kills), 28, AX.ink, SEMIBOLD, 'center', 0),
    text(COL.deaths - 55, top, 110, ROW_H, String(player.deaths), 28, AX.ink, SEMIBOLD, 'center', 0),
    text(COL.kdr - 55, top, 110, ROW_H, player.kdr, 28, kdColor(player.kdr), SEMIBOLD, 'center', 0),
    text(COL.dia - 55, top, 110, ROW_H, String(player.diamonds), 28, AX.ink, SEMIBOLD, 'center', 0),
    text(COL.ems - 55, top, 110, ROW_H, String(player.emeralds), 28, AX.ink, SEMIBOLD, 'center', 0),
    h('div', {
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
        gap: 8,
      },
    },
      h('div', {
        style: { fontFamily: MEDIUM, fontSize: 21, letterSpacing: 0.2, lineHeight: '26px', color: AX.mute },
      }, `${player.eloBefore} -> ${player.eloAfter}`),
      icon(arrow, 14, color),
      h('div', {
        style: { fontFamily: SEMIBOLD, fontSize: 24, lineHeight: '28px', color },
      }, String(Math.abs(delta))),
    ),
  ].filter(Boolean) as VNode[];
}

function sectionHeader(title: string, top: number, accent: string): VNode[] {
  const labels: Array<{ label: string; center: number }> = [
    { label: 'KILLS', center: COL.kills },
    { label: 'DEATHS', center: COL.deaths },
    { label: 'K/D', center: COL.kdr },
    { label: 'DIA', center: COL.dia },
    { label: 'EMS', center: COL.ems },
  ];

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: top - 3,
        width: IW,
        height: 3,
        backgroundColor: accent,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top,
        width: IW,
        height: SEC_HEAD,
        backgroundColor: AX.block,
      },
    }),
    text(IX + 18, top, 500, SEC_HEAD, title, 17, AX.blockText, SEMIBOLD, 'left', 2),
    ...labels.map(label => text(label.center - 60, top, 120, SEC_HEAD, label.label, 14, AX.blockText, SEMIBOLD, 'center', 1.6)),
    text(COL.eloX, top, COL.eloW, SEC_HEAD, 'ELO CHANGE', 14, AX.blockText, SEMIBOLD, 'right', 1.6),
  ];
}

function metadata(input: ScoreTemplateInput): VNode[] {
  const columns: Array<{ label: string; value: string; x: number; width: number }> = [
    { label: 'MAP', value: input.map, x: IX, width: 380 },
    { label: 'GAME ID', value: `#${input.gameId}`, x: IX + 380, width: 220 },
    { label: 'DATE', value: input.date, x: IX + 600, width: 320 },
    { label: 'SCORED AT', value: input.scoredAt, x: IX + 920, width: 300 },
    { label: 'DURATION', value: input.duration, x: IX + 1220, width: 280 },
    { label: 'MODE', value: input.mode, x: IX + 1500, width: 284 },
  ];
  const valueTop = META_TOP + META_HEAD;

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: META_TOP,
        width: IW,
        height: META_HEAD,
        backgroundColor: AX.block,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: valueTop,
        width: IW,
        height: META_ROW,
        backgroundColor: AX.paper,
        borderBottomWidth: 1,
        borderBottomColor: AX.lineSoft,
      },
    }),
    ...columns.flatMap(column => [
      text(column.x + 18, META_TOP, column.width - 36, META_HEAD, column.label, 12, AX.blockMute, SEMIBOLD, 'left', 1.8),
      text(column.x + 18, valueTop, column.width - 36, META_ROW, column.value, 26, AX.ink, SEMIBOLD, 'left', 0),
    ]),
    ...columns.slice(1).flatMap(column => [
      h('div', {
        style: {
          position: 'absolute',
          left: column.x,
          top: META_TOP,
          width: 1,
          height: META_HEAD + META_ROW,
          backgroundColor: AX.blockLine,
        },
      }),
    ]),
  ];
}

function footer(input: ScoreTemplateInput): VNode[] {
  const buttonW = 320;
  const inviteLabel = input.inviteLink.includes('.gg/')
    ? input.inviteLink.slice(input.inviteLink.lastIndexOf('.gg/'))
    : input.inviteLink;
  return [
    h('svg', {
      width: IW,
      height: FOOT_H,
      style: { position: 'absolute', left: IX, top: FOOT_TOP },
    }, h('path', { d: `M0 0 H${IW} L${IW - 9.6} ${FOOT_H} H0 Z`, fill: AX.block })),
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: FOOT_TOP,
        width: 4,
        height: FOOT_H,
        backgroundColor: AX.accent,
      },
    }),
    text(IX + 18, FOOT_TOP, 620, FOOT_H, input.serverName, 18, AX.blockText, SEMIBOLD, 'left', 1.4),
    text(IX + 640, FOOT_TOP, 520, FOOT_H, `GAME #${input.gameId}  /  ${input.mode.toUpperCase()}`, 12, AX.blockMute, MEDIUM, 'center', 1.4),
    h('svg', {
      width: buttonW,
      height: 40,
      style: { position: 'absolute', left: IX + IW - buttonW, top: FOOT_TOP + 4 },
    }, h('path', { d: `M8 0 H${buttonW} L${buttonW - 8} 40 H0 Z`, fill: AX.accent })),
    text(IX + IW - buttonW + 8, FOOT_TOP + 4, buttonW - 16, 40, inviteLabel, 18, AX.white, SEMIBOLD, 'center', 1.2),
  ];
}

function header(input: ScoreTemplateInput): VNode[] {
  const metaX = IX + IW - 382;
  const metaW = 282;
  return [
    text(IX + 660, SHEET_Y + 6, 860, 116, 'RESULT', 110, 'rgba(236, 72, 153, 0.06)', SEMIBOLD, 'right', -2),
    slash(IX, SHEET_Y + 22, 20, 6, AX.accent),
    text(IX + 30, SHEET_Y + 20, 300, 16, 'GAME RESULT', 11, AX.mute, SEMIBOLD, 'left', 2.2),
    text(IX, SHEET_Y + 40, 860, 58, input.map, 48, AX.ink, SEMIBOLD, 'left', -1.2),
    text(IX, SHEET_Y + 100, 980, 20, `${input.mode.toUpperCase()} MATCH  /  ${input.date}  /  ${input.scoredAt}`, 13, AX.mute, MEDIUM, 'left', 1.4),
    text(metaX, SHEET_Y + 22, metaW, 30, `GAME #${input.gameId}`, 22, AX.ink, SEMIBOLD, 'right', 0.4),
    text(metaX, SHEET_Y + 56, metaW, 18, input.mode.toUpperCase(), 12, AX.accent, SEMIBOLD, 'right', 2),
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: SHEET_Y + 124,
        width: IW,
        height: 2,
        backgroundColor: AX.ink,
      },
    }),
  ];
}

function avatarOverlay(winners: ScoreTemplatePlayer[], losers: ScoreTemplatePlayer[]): VNode[] {
  return [
    ...winners.map((player, index) => avatar(player, WIN_ROWS + index * ROW_H, AX.win)),
    ...losers.map((player, index) => avatar(player, LOSE_ROWS + index * ROW_H, AX.loss)),
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
      backgroundColor: AX.pageBottom,
    },
  },
    ...axPage(WIDTH, HEIGHT),
    h('div', {
      style: {
        position: 'absolute',
        left: SHEET_X + 10,
        top: SHEET_Y + 10,
        width: SHEET_W,
        height: SHEET_H,
        backgroundColor: 'rgba(236, 72, 153, 0.3)',
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: SHEET_X,
        top: SHEET_Y,
        width: SHEET_W,
        height: SHEET_H,
        backgroundColor: AX.paper,
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: AX.ink,
      },
    }),
    ...header(input),
    ...sectionHeader('WINNERS', WIN_TOP, AX.accent),
    ...Array.from({ length: 4 }, (_, index) => {
      const player = input.winners[index];
      if (!player) return [];
      const partyColor = player.partyId ? partyColors.get(player.partyId) : undefined;
      return row(player, index, WIN_ROWS + index * ROW_H, AX.win, partyColor);
    }).flat(),
    ...sectionHeader('LOSERS', LOSE_TOP, AX.accentSoft),
    ...Array.from({ length: 4 }, (_, index) => {
      const player = input.losers[index];
      if (!player) return [];
      const partyColor = player.partyId ? partyColors.get(player.partyId) : undefined;
      return row(player, index, LOSE_ROWS + index * ROW_H, AX.loss, partyColor);
    }).flat(),
    ...metadata(input),
    ...footer(input),
    ...axBrackets(SHEET_X + 10, SHEET_Y + 10, SHEET_W - 20, SHEET_H - 20, AX.lineSoft, 14, 2),
    ...axStamp(SHEET_X + SHEET_W - 96, SHEET_Y - 22, 'RBW', 56),
    grainLayer(WIDTH, HEIGHT, 0.16),
    ...avatarOverlay(input.winners, input.losers),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
