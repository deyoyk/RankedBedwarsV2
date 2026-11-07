import { h, VNode } from '../renderer';
import { avatar, badge, COLORS, decor, divider, FONT, gameFooter, MEDIUM, panel, rootStyle, text } from '../theme';

export type ScoreTemplatePlayer = {
  username: string;
  elo_before: number;
  elo_after: number;
  oldElo?: number;
  newElo?: number;
  mvp: boolean;
  bedbreaker?: boolean;
  avatar: string;
};

export type ScoreTemplateInput = {
  gameId: number;
  winners: ScoreTemplatePlayer[];
  losers: ScoreTemplatePlayer[];
  serverName: string;
  inviteLink: string;
};

const WIDTH = 1920;
const HEIGHT = 1080;

const CARD_W = 850;
const CARD_XS = [80, 990];
const CARD_TOP = 236;
const CARD_BOTTOM = 944;
const HEADER_H = 64;
const COLUMNS_H = 32;
const SUMMARY_H = 64;
const CARD_CHROME = HEADER_H + COLUMNS_H + SUMMARY_H;

const NAME_X = 86;
const NAME_W = 240;
const MVP_X = 334;
const MVP_W = 62;
const BED_X = 402;
const BED_W = 62;
const DELTA_X = 470;
const DELTA_W = 120;
const BEFORE_X = 610;
const BEFORE_W = 80;
const ARROW_X = 696;
const ARROW_W = 24;
const AFTER_X = 726;
const AFTER_W = 100;

function beforeElo(p: ScoreTemplatePlayer): number {
  return p.elo_before ?? p.oldElo ?? 0;
}

function afterElo(p: ScoreTemplatePlayer): number {
  return p.elo_after ?? p.newElo ?? 0;
}

function eloDelta(p: ScoreTemplatePlayer): number {
  return afterElo(p) - beforeElo(p);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function header(input: ScoreTemplateInput): VNode {
  const playerCount = input.winners.length + input.losers.length;

  return h('div', {},
    badge((WIDTH - 200) / 2, 26, 200, `GAME #${input.gameId}`, {
      color: COLORS.text,
      background: 'rgba(21,31,45,0.9)',
      border: COLORS.line,
      height: 42,
      size: 17,
      letterSpacing: 1,
    }),

    text(0, 76, WIDTH, 82, 'MATCH RESULTS', 68, COLORS.text, MEDIUM, 'center', 2.4),

    text(
      0, 164, WIDTH, 28,
      `${playerCount} PLAYERS · FINAL SCOREBOARD`,
      18, COLORS.muted, MEDIUM, 'center', 1.6,
    ),

    divider((WIDTH - 120) / 2, 210, 120, COLORS.cyan, 2),
  );
}

function playerRow(
  p: ScoreTemplatePlayer,
  cardX: number,
  rowTop: number,
  rowH: number,
  index: number,
): (VNode | null)[] {
  const avatarSize = Math.max(24, Math.min(48, rowH - 18));
  const nameSize = Math.max(
    15,
    Math.min(42, rowH - 16, Math.floor(410 / Math.max(6, p.username.length))),
  );
  const eloSize = Math.max(14, Math.min(30, rowH - 24));
  const deltaSize = Math.max(15, Math.min(36, rowH - 20));
  const mvpH = Math.max(24, Math.min(34, rowH - 18));
  const mvpSize = Math.max(12, Math.min(17, rowH - 24));
  const delta = eloDelta(p);
  const deltaColor = delta > 0 ? COLORS.green : delta < 0 ? COLORS.red : COLORS.muted;
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

    p.mvp
      ? badge(cardX + MVP_X, rowTop + (rowH - mvpH) / 2, MVP_W, 'MVP', {
          color: COLORS.gold,
          background: 'rgba(251,191,36,0.12)',
          border: 'rgba(251,191,36,0.36)',
          height: mvpH,
          size: mvpSize,
          letterSpacing: 0.8,
        })
      : null,

    p.bedbreaker
      ? badge(cardX + BED_X, rowTop + (rowH - mvpH) / 2, BED_W, 'BED', {
          color: COLORS.cyan,
          background: 'rgba(77,225,242,0.10)',
          border: 'rgba(77,225,242,0.32)',
          height: mvpH,
          size: mvpSize,
          letterSpacing: 0.8,
        })
      : null,

    text(
      cardX + DELTA_X, rowTop, DELTA_W, rowH,
      signed(delta),
      deltaSize, deltaColor, MEDIUM, 'center',
    ),

    text(
      cardX + BEFORE_X, rowTop, BEFORE_W, rowH,
      String(beforeElo(p)),
      eloSize, COLORS.muted, FONT, 'right',
    ),

    text(
      cardX + ARROW_X, rowTop, ARROW_W, rowH,
      '›',
      eloSize, COLORS.faint, FONT, 'center',
    ),

    text(
      cardX + AFTER_X, rowTop, AFTER_W, rowH,
      String(afterElo(p)),
      eloSize, COLORS.text, MEDIUM, 'right',
    ),

    divider(cardX + 24, rowTop + rowH - 1, CARD_W - 48, COLORS.lineSoft, 1),
  ];
}

function teamCard(
  players: ScoreTemplatePlayer[],
  cardX: number,
  top: number,
  cardH: number,
  rowH: number,
  maxRows: number,
  title: string,
  subtitle: string,
  color: string,
): (VNode | null)[] {
  const summaryTop = top + cardH - SUMMARY_H;
  const rowsTop = top + HEADER_H + COLUMNS_H;
  const playerCount = players.length;

  const totalBefore = players.reduce((sum, p) => sum + beforeElo(p), 0);
  const totalAfter = players.reduce((sum, p) => sum + afterElo(p), 0);
  const totalDelta = totalAfter - totalBefore;
  const avgAfter = playerCount > 0 ? Math.round(totalAfter / playerCount) : 0;
  const deltaColor = totalDelta > 0 ? COLORS.green : totalDelta < 0 ? COLORS.red : COLORS.muted;

  const rows = players.flatMap((p, i) =>
    playerRow(p, cardX, rowsTop + i * rowH, rowH, i),
  );

  const empty = playerCount === 0
    ? text(
        cardX + 24, rowsTop, CARD_W - 48, maxRows * rowH,
        'NO PLAYERS RECORDED',
        15, COLORS.faint, MEDIUM, 'center', 1.6,
      )
    : null;

  return [
    panel(cardX, top, CARD_W, cardH, 20),

    text(cardX + 28, top + 13, 340, 26, title, 19, color, MEDIUM, 'left', 1.6),
    text(cardX + 28, top + 37, 340, 18, subtitle, 12, COLORS.muted, MEDIUM, 'left', 1.4),
    text(
      cardX + CARD_W - 228, top + 21, 200, 26,
      `${playerCount} ${playerCount === 1 ? 'PLAYER' : 'PLAYERS'}`,
      16, COLORS.muted, MEDIUM, 'right', 1,
    ),

    divider(cardX + 24, top + HEADER_H, CARD_W - 48, COLORS.line, 1),

    text(cardX + 24, top + HEADER_H, 200, COLUMNS_H, 'PLAYER', 13, COLORS.muted, MEDIUM, 'left', 1.4),
    text(cardX + DELTA_X, top + HEADER_H, DELTA_W, COLUMNS_H, 'ELO CHANGE', 13, COLORS.muted, MEDIUM, 'center', 1.2),
    text(cardX + BEFORE_X, top + HEADER_H, BEFORE_W, COLUMNS_H, 'BEFORE', 13, COLORS.muted, MEDIUM, 'right', 1),
    text(cardX + AFTER_X, top + HEADER_H, AFTER_W, COLUMNS_H, 'AFTER', 13, COLORS.muted, MEDIUM, 'right', 1),

    ...rows,
    empty,

    divider(cardX + 24, summaryTop, CARD_W - 48, COLORS.line, 1),

    text(cardX + 28, summaryTop + 12, 300, 18, 'TOTAL ELO CHANGE', 13, COLORS.muted, MEDIUM, 'left', 1.2),
    text(cardX + 28, summaryTop + 29, 300, 32, `${signed(totalDelta)} RR`, 30, deltaColor, MEDIUM),

    text(cardX + CARD_W - 288, summaryTop + 12, 260, 18, 'AVERAGE ELO', 13, COLORS.muted, MEDIUM, 'right', 1.2),
    text(cardX + CARD_W - 288, summaryTop + 29, 260, 32, String(avgAfter), 30, COLORS.text, MEDIUM, 'right'),
  ];
}

export function scoreTemplate(input: ScoreTemplateInput): { root: VNode; width: number; height: number } {
  const maxRows = Math.max(1, input.winners.length, input.losers.length);
  const available = CARD_BOTTOM - CARD_TOP;
  const rowH = Math.max(34, Math.min(104, Math.floor((available - CARD_CHROME) / maxRows)));
  const cardH = CARD_CHROME + maxRows * rowH;
  const cardTop = CARD_TOP + Math.max(0, Math.floor((available - cardH) / 2));

  const root = h('div', { style: rootStyle(WIDTH, HEIGHT) },
    decor(WIDTH, HEIGHT, 'score'),

    header(input),

    ...teamCard(
      input.winners, CARD_XS[0], cardTop, cardH, rowH, maxRows,
      'WINNERS', 'WINNING TEAM', COLORS.green,
    ),
    ...teamCard(
      input.losers, CARD_XS[1], cardTop, cardH, rowH, maxRows,
      'LOSERS', 'LOSING TEAM', COLORS.red,
    ),

    gameFooter(WIDTH, input.serverName, input.inviteLink),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
