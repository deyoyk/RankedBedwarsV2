import { h, VNode } from '../renderer';
import { avatar, COLORS, divider, FONT, gameFooter, MEDIUM, rootStyle, text } from '../theme';

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
  isRanked?: boolean;
  minElo?: number;
  maxElo?: number;
  serverName: string;
  inviteLink: string;
};

const WIDTH = 1920;
const HEIGHT = 1080;
const X = 72;
const W = WIDTH - X * 2;
const WINNER_TOP = 224;
const LOSER_TOP = 620;
const SECTION_H = 372;
const ROWS_TOP_OFFSET = 80;
const ROWS_BOTTOM_PAD = 16;
const FOOTER_Y = 1008;

function beforeElo(player: ScoreTemplatePlayer): number {
  return player.elo_before ?? player.oldElo ?? 0;
}

function afterElo(player: ScoreTemplatePlayer): number {
  return player.elo_after ?? player.newElo ?? 0;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function header(input: ScoreTemplateInput): VNode[] {
  const ranked = input.isRanked === true;

  return [
    text(X, 34, 420, 32, `GAME #${input.gameId}`, 32, COLORS.muted, MEDIUM, 'left', 0.8),
    text(WIDTH - X - 420, ranked ? 18 : 24, 420, 34, ranked ? 'Ranked' : 'Unranked', 28, COLORS.muted, MEDIUM, 'right', 1.1),
    ranked
      ? text(WIDTH - X - 420, 50, 420, 28, `Queue ${input.minElo ?? 0} - ${input.maxElo ?? 0}`, 24, COLORS.faint, MEDIUM, 'right', 0.7)
      : null,
    text(X, 84, 1300, 78, 'MATCH RESULT', 72, COLORS.text, MEDIUM, 'left', 0.5),
    text(X, 164, 900, 26, 'FINAL SCOREBOARD', 18, COLORS.muted, MEDIUM, 'left', 1.6),
    divider(X, 198, W, COLORS.line, 1),
  ].filter(Boolean) as VNode[];
}

function playerRow(
  player: ScoreTemplatePlayer,
  top: number,
  rowH: number,
): VNode[] {
  const avatarSize = Math.max(24, Math.min(44, rowH - 8));
  const nameSize = Math.max(20, Math.min(38, rowH - 6));
  const eloSize = Math.max(18, Math.min(28, rowH - 8));
  const deltaSize = Math.max(20, Math.min(34, rowH - 4));
  const tagSize = Math.max(22, Math.min(28, rowH - 6));
  const rowY = top + (rowH - avatarSize) / 2;
  const before = beforeElo(player);
  const after = afterElo(player);
  const delta = after - before;
  const deltaColor = delta > 0 ? COLORS.green : delta < 0 ? COLORS.red : COLORS.muted;

  return [
    avatar(player.avatar, X, rowY, avatarSize, 8),

    text(X + 56, top, 720, rowH, player.username, nameSize, COLORS.text, MEDIUM),

    player.mvp
      ? text(X + 786, top, 100, rowH, 'MVP', tagSize, COLORS.gold, MEDIUM, 'left', 1)
      : null,

    player.bedbreaker
      ? text(X + 886, top, 100, rowH, 'BED', tagSize, COLORS.cyan, MEDIUM, 'left', 1)
      : null,

    text(
      X + 1080, top, 360, rowH,
      `${before}  ->  ${after}`,
      eloSize, COLORS.muted, FONT, 'right',
    ),

    text(
      X + W - 280, top, 280, rowH,
      signed(delta),
      deltaSize, deltaColor, MEDIUM, 'right',
    ),
  ].filter(Boolean) as VNode[];
}

function teamSection(
  players: ScoreTemplatePlayer[],
  top: number,
  title: string,
  color: string,
): VNode[] {
  const rowsTop = top + ROWS_TOP_OFFSET;
  const rowsAvailable = SECTION_H - ROWS_TOP_OFFSET - ROWS_BOTTOM_PAD;
  const maxRows = Math.max(1, players.length);
  const rowH = Math.max(32, Math.min(84, Math.floor(rowsAvailable / maxRows)));

  const totalBefore = players.reduce((sum, player) => sum + beforeElo(player), 0);
  const totalAfter = players.reduce((sum, player) => sum + afterElo(player), 0);
  const totalDelta = totalAfter - totalBefore;
  const deltaColor = totalDelta > 0 ? COLORS.green : totalDelta < 0 ? COLORS.red : COLORS.muted;

  const rows = players.flatMap((player, index) =>
    playerRow(player, rowsTop + index * rowH, rowH),
  );

  const empty = players.length === 0
    ? [text(X, rowsTop, W, rowH, 'NO PLAYERS RECORDED', 22, COLORS.faint, MEDIUM, 'left', 1.2)]
    : [];

  return [
    text(X, top, 700, 64, title, 54, color, MEDIUM, 'left', 0.4),
    text(
      X + W - 520, top + 8, 520, 30,
      `TOTAL ${signed(totalDelta)} ELO`,
      24, deltaColor, MEDIUM, 'right',
    ),
    ...rows,
    ...empty,
  ];
}

export function scoreTemplate(input: ScoreTemplateInput): { root: VNode; width: number; height: number } {
  const root = h('div', { style: rootStyle(WIDTH, HEIGHT) },
    ...header(input),
    ...teamSection(input.winners, WINNER_TOP, 'WINNERS', COLORS.green),
    ...teamSection(input.losers, LOSER_TOP, 'LOSERS', COLORS.red),
    gameFooter(WIDTH, input.serverName, input.inviteLink, FOOTER_Y),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
