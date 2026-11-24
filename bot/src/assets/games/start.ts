import { h, VNode } from '../renderer';
import { MEDIUM, SEMIBOLD, text } from '../theme';
import { grainLayer } from '../grain';
import { DivisionTag, divisionTagBadge } from '../divisionTag';
import { AX, axBrackets, axPage, axStamp } from '../themes/defaultTheme';

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
const SHEET_X = 40;
const SHEET_Y = 40;
const SHEET_W = WIDTH - SHEET_X * 2;
const SHEET_H = HEIGHT - SHEET_Y * 2;
const PAD = 28;
const IX = SHEET_X + PAD;
const IW = SHEET_W - PAD * 2;
const SEC_HEAD = 46;
const ROW_H = 58;
const GREEN_TOP = SHEET_Y + 138;
const GREEN_ROWS = GREEN_TOP + SEC_HEAD;
const RED_TOP = GREEN_ROWS + 4 * ROW_H + 16;
const RED_ROWS = RED_TOP + SEC_HEAD;
const INFO_TOP = SHEET_Y + 726;
const INFO_HEAD = 42;
const INFO_ROW = 52;
const FOOT_TOP = SHEET_Y + 838;
const FOOT_H = 48;

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

function captainBadge(): VNode {
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
      backgroundColor: '#F3E8FF',
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: '#C4B5FD',
    },
  },
    h('div', {
      style: { fontFamily: SEMIBOLD, fontSize: 13, letterSpacing: 1.2, lineHeight: '16px', color: AX.accentDeep },
    }, 'CPT'),
  );
}

function avatar(player: StartTemplatePlayer, top: number, teamColor: string): VNode {
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

function row(player: StartTemplatePlayer, index: number, top: number, teamColor: string): VNode[] {
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top,
        width: IW,
        height: ROW_H,
        backgroundColor: index % 2 === 0 ? AX.paper : AX.paperDim,
        borderBottomWidth: 1,
        borderBottomColor: AX.lineSoft,
      },
    }),
    avatar(player, top, teamColor),
    h('div', {
      style: {
        position: 'absolute',
        left: IX + 62,
        top,
        width: 760,
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
      player.isCaptain ? captainBadge() : null,
    ),
    text(IX + IW - 180, top, 160, ROW_H, String(player.elo), 28, AX.ink, SEMIBOLD, 'right', 0),
  ].filter(Boolean) as VNode[];
}

function sectionHeader(title: string, top: number, teamColor: string, avg: number): VNode[] {
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: top - 3,
        width: IW,
        height: 3,
        backgroundColor: teamColor,
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
    text(IX + 18, top, 520, SEC_HEAD, title, 17, teamColor, SEMIBOLD, 'left', 2),
    text(IX + IW - 420, top, 400, SEC_HEAD, `AVG ${avg}`, 17, AX.blockText, SEMIBOLD, 'right', 1.2),
  ];
}

function info(input: StartTemplateInput): VNode[] {
  const queue = input.isRanked ? `${input.minElo ?? 0} - ${input.maxElo ?? 0}` : 'CASUAL';
  const columns: Array<{ label: string; value: string; x: number; width: number }> = [
    { label: 'GAME ID', value: `#${input.gameId}`, x: IX, width: 380 },
    { label: 'MODE', value: input.modeLabel, x: IX + 380, width: 380 },
    { label: 'QUEUE', value: queue, x: IX + 760, width: 520 },
    { label: 'FORMAT', value: `${input.team1.length}V${input.team2.length}`, x: IX + 1280, width: 504 },
  ];
  const valueTop = INFO_TOP + INFO_HEAD;

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: INFO_TOP,
        width: IW,
        height: INFO_HEAD,
        backgroundColor: AX.block,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: valueTop,
        width: IW,
        height: INFO_ROW,
        backgroundColor: AX.paper,
        borderBottomWidth: 1,
        borderBottomColor: AX.lineSoft,
      },
    }),
    ...columns.flatMap(column => [
      text(column.x + 18, INFO_TOP, column.width - 36, INFO_HEAD, column.label, 12, AX.blockMute, SEMIBOLD, 'left', 1.8),
      text(column.x + 18, valueTop, column.width - 36, INFO_ROW, column.value, 26, AX.ink, SEMIBOLD, 'left', 0),
    ]),
    ...columns.slice(1).flatMap(column => [
      h('div', {
        style: {
          position: 'absolute',
          left: column.x,
          top: INFO_TOP,
          width: 1,
          height: INFO_HEAD + INFO_ROW,
          backgroundColor: AX.blockLine,
        },
      }),
    ]),
  ];
}

function footer(input: StartTemplateInput): VNode[] {
  const buttonW = 320;
  const inviteLabel = input.inviteLink.includes('.gg/')
    ? input.inviteLink.slice(input.inviteLink.lastIndexOf('.gg/'))
    : input.inviteLink;
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: IX,
        top: FOOT_TOP,
        width: IW,
        height: FOOT_H,
        backgroundColor: AX.block,
      },
    }),
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
    text(IX + 640, FOOT_TOP, 520, FOOT_H, `GAME #${input.gameId}  /  ${input.modeLabel.toUpperCase()}`, 12, AX.blockMute, MEDIUM, 'center', 1.4),
    h('svg', {
      width: buttonW,
      height: 40,
      style: { position: 'absolute', left: IX + IW - buttonW, top: FOOT_TOP + 4 },
    }, h('path', { d: `M8 0 H${buttonW} L${buttonW - 8} 40 H0 Z`, fill: AX.accent })),
    text(IX + IW - buttonW + 8, FOOT_TOP + 4, buttonW - 16, 40, inviteLabel, 18, AX.white, SEMIBOLD, 'center', 1.2),
  ];
}

function header(input: StartTemplateInput): VNode[] {
  const metaX = IX + IW - 382;
  const metaW = 282;
  const queue = input.isRanked ? `${input.minElo ?? 0} - ${input.maxElo ?? 0}` : 'CASUAL';
  return [
    text(IX + 660, SHEET_Y + 6, 860, 116, 'START', 110, 'rgba(124, 58, 237, 0.06)', SEMIBOLD, 'right', -2),
    slash(IX, SHEET_Y + 22, 20, 6, AX.accent),
    text(IX + 30, SHEET_Y + 20, 300, 16, 'MATCH START', 11, AX.mute, SEMIBOLD, 'left', 2.2),
    text(IX, SHEET_Y + 40, 860, 58, input.mapName, 48, AX.ink, SEMIBOLD, 'left', -1.2),
    text(IX, SHEET_Y + 100, 980, 20, `${input.modeLabel.toUpperCase()} MATCH  /  QUEUE ${queue}`, 13, AX.mute, MEDIUM, 'left', 1.4),
    text(metaX, SHEET_Y + 22, metaW, 30, `GAME #${input.gameId}`, 22, AX.ink, SEMIBOLD, 'right', 0.4),
    text(metaX, SHEET_Y + 56, metaW, 18, input.modeLabel.toUpperCase(), 12, AX.accent, SEMIBOLD, 'right', 2),
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

function avatarOverlay(players: StartTemplatePlayer[], top: number, teamColor: string): VNode[] {
  return players.slice(0, 4).map((player, index) => avatar(player, top + index * ROW_H, teamColor));
}

export function startTemplate(input: StartTemplateInput): { root: VNode; width: number; height: number } {
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
        backgroundColor: 'rgba(124, 58, 237, 0.3)',
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
    ...sectionHeader('TEAM GREEN', GREEN_TOP, AX.win, input.team1Avg),
    ...Array.from({ length: 4 }, (_, index) => {
      const player = input.team1[index];
      if (!player) return [];
      return row(player, index, GREEN_ROWS + index * ROW_H, AX.win);
    }).flat(),
    ...sectionHeader('TEAM RED', RED_TOP, AX.loss, input.team2Avg),
    ...Array.from({ length: 4 }, (_, index) => {
      const player = input.team2[index];
      if (!player) return [];
      return row(player, index, RED_ROWS + index * ROW_H, AX.loss);
    }).flat(),
    ...info(input),
    ...footer(input),
    ...axBrackets(SHEET_X + 10, SHEET_Y + 10, SHEET_W - 20, SHEET_H - 20, AX.lineSoft, 14, 2),
    ...axStamp(SHEET_X + SHEET_W - 96, SHEET_Y - 22, 'RBW', 56),
    grainLayer(WIDTH, HEIGHT, 0.16),
    ...avatarOverlay(input.team1, GREEN_ROWS, AX.win),
    ...avatarOverlay(input.team2, RED_ROWS, AX.loss),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
