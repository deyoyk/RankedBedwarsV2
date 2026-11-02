import { h, VNode } from '../renderer';
import {
  avatar,
  badge,
  COLORS,
  decor,
  divider,
  gameFooter,
  MEDIUM,
  panel,
  rootStyle,
  text,
} from '../theme';

export type StartTemplatePlayer = {
  username: string;
  elo: number;
  isCaptain: boolean;
  avatar: string;
};

export type StartTemplateInput = {
  gameId: number;
  mapName: string;
  modeLabel: string;
  team1: StartTemplatePlayer[];
  team2: StartTemplatePlayer[];
  team1Avg: number;
  team2Avg: number;
  serverName: string;
  inviteLink: string;
};

const WIDTH = 1920;
const HEIGHT = 1080;

const CARD_W = 800;
const CARD_X1 = 80;
const CARD_X2 = 1040;
const CARD_TOP = 240;
const CARD_BOTTOM = 936;
const HEADER_H = 64;
const COLUMNS_H = 32;
const SUMMARY_H = 60;
const CARD_CHROME = HEADER_H + COLUMNS_H + SUMMARY_H;

// Column offsets inside a card.
const NAME_X = 86;
const NAME_W = 490;
const CPT_X = 590;
const CPT_W = 56;
const ELO_X = 666;
const ELO_W = 110;

function header(input: StartTemplateInput): VNode {
  return h('div', {},
    badge((WIDTH - 174) / 2, 30, 174, `GAME #${input.gameId}`, {
      color: COLORS.text,
      background: 'rgba(21,31,45,0.9)',
      border: COLORS.line,
      height: 34,
      size: 13,
      letterSpacing: 1.4,
    }),

    text(0, 76, WIDTH, 82, 'MATCH START', 68, COLORS.text, MEDIUM, 'center', 2.4),

    text(
      0, 164, WIDTH, 28,
      `${input.mapName} · ${input.modeLabel}`,
      26, COLORS.cyan, MEDIUM, 'center', 1.2,
    ),

    divider((WIDTH - 120) / 2, 210, 120, COLORS.cyan, 2),
  );
}

function playerRow(
  p: StartTemplatePlayer,
  cardX: number,
  rowTop: number,
  rowH: number,
  index: number,
): (VNode | null)[] {
  const avatarSize = Math.max(24, Math.min(48, rowH - 18));
  const nameSize = Math.max(
    15,
    Math.min(34, rowH - 16, Math.floor(760 / Math.max(6, p.username.length))),
  );
  const eloSize = Math.max(12, Math.min(26, rowH - 24));
  const cptH = Math.max(18, Math.min(24, rowH - 18));
  const cptSize = Math.max(9, Math.min(11, rowH - 24));
  const rowY = rowTop + (rowH - avatarSize) / 2;

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: cardX,
        top: rowTop,
        width: CARD_W,
        height: rowH,
        backgroundColor: index % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.10)',
      },
    }),

    avatar(p.avatar, cardX + 24, rowY, avatarSize, 10),

    text(
      cardX + NAME_X, rowTop, NAME_W, rowH,
      p.username,
      nameSize, COLORS.text, MEDIUM,
    ),

    p.isCaptain
      ? badge(cardX + CPT_X, rowTop + (rowH - cptH) / 2, CPT_W, 'CPT', {
          color: COLORS.gold,
          background: 'rgba(251,191,36,0.12)',
          border: 'rgba(251,191,36,0.36)',
          height: cptH,
          size: cptSize,
          letterSpacing: 0.8,
        })
      : null,

    text(
      cardX + ELO_X, rowTop, ELO_W, rowH,
      String(p.elo),
      eloSize, COLORS.text, MEDIUM, 'right',
    ),

    divider(cardX + 24, rowTop + rowH - 1, CARD_W - 48, COLORS.lineSoft, 1),
  ];
}

function teamCard(
  players: StartTemplatePlayer[],
  cardX: number,
  top: number,
  cardH: number,
  rowH: number,
  maxRows: number,
  title: string,
  avg: number,
  color: string,
): (VNode | null)[] {
  const summaryTop = top + cardH - SUMMARY_H;
  const rowsTop = top + HEADER_H + COLUMNS_H;
  const playerCount = players.length;
  const totalElo = players.reduce((sum, p) => sum + (p.elo || 0), 0);
  const spread = players.length > 0
    ? Math.max(...players.map(p => p.elo || 0)) - Math.min(...players.map(p => p.elo || 0))
    : 0;

  const rows = players.flatMap((p, i) =>
    playerRow(p, cardX, rowsTop + i * rowH, rowH, i),
  );

  const empty = playerCount === 0
    ? text(
        cardX + 24, rowsTop, CARD_W - 48, maxRows * rowH,
        'NO PLAYERS',
        15, COLORS.faint, MEDIUM, 'center', 1.8,
      )
    : null;

  return [
    panel(cardX, top, CARD_W, cardH, 20),

    text(cardX + 28, top + 13, 320, 26, title, 16, color, MEDIUM, 'left', 1.8),
    text(
      cardX + 28, top + 37, 320, 18,
      `${playerCount} ${playerCount === 1 ? 'PLAYER' : 'PLAYERS'}`,
      10, COLORS.muted, MEDIUM, 'left', 1.6,
    ),
    text(
      cardX + CARD_W - 328, top + 20, 300, 26,
      `AVG ${avg}`,
      20, COLORS.text, MEDIUM, 'right', 0.8,
    ),

    divider(cardX + 24, top + HEADER_H, CARD_W - 48, COLORS.line, 1),

    text(cardX + 24, top + HEADER_H, 200, COLUMNS_H, 'PLAYER', 10, COLORS.faint, MEDIUM, 'left', 1.6),
    text(cardX + ELO_X, top + HEADER_H, ELO_W, COLUMNS_H, 'ELO', 10, COLORS.faint, MEDIUM, 'right', 1.4),

    ...rows,
    empty,

    divider(cardX + 24, summaryTop, CARD_W - 48, COLORS.line, 1),

    text(cardX + 28, summaryTop + 11, 300, 18, 'TOTAL ELO', 10, COLORS.muted, MEDIUM, 'left', 1.4),
    text(cardX + 28, summaryTop + 29, 300, 24, String(totalElo), 20, COLORS.text, MEDIUM),

    text(cardX + CARD_W - 288, summaryTop + 11, 260, 18, 'ELO SPREAD', 10, COLORS.muted, MEDIUM, 'right', 1.4),
    text(cardX + CARD_W - 288, summaryTop + 29, 260, 24, String(spread), 20, COLORS.text, MEDIUM, 'right'),
  ];
}

function versus(top: number, cardH: number): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: WIDTH / 2 - 36,
      top: top + cardH / 2 - 36,
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: '#0a1018',
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: COLORS.line,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: MEDIUM,
      fontSize: 22,
      letterSpacing: 1.4,
      color: COLORS.text,
    },
  }, 'VS');
}

export function startTemplate(input: StartTemplateInput): { root: VNode; width: number; height: number } {
  const maxRows = Math.max(1, input.team1.length, input.team2.length);
  const available = CARD_BOTTOM - CARD_TOP;
  const rowH = Math.max(32, Math.min(108, Math.floor((available - CARD_CHROME) / maxRows)));
  const cardH = CARD_CHROME + maxRows * rowH;
  const cardTop = CARD_TOP + Math.max(0, Math.floor((available - cardH) / 2));

  const root = h('div', { style: rootStyle(WIDTH, HEIGHT) },
    decor(WIDTH, HEIGHT, 'start'),

    header(input),

    ...teamCard(input.team1, CARD_X1, cardTop, cardH, rowH, maxRows, 'TEAM GREEN', input.team1Avg, COLORS.green),
    ...teamCard(input.team2, CARD_X2, cardTop, cardH, rowH, maxRows, 'TEAM RED', input.team2Avg, COLORS.red),

    versus(cardTop, cardH),

    gameFooter(WIDTH, input.serverName, input.inviteLink),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
