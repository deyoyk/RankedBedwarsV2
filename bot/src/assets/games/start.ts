import { h, VNode } from '../renderer';
import { avatar, COLORS, divider, FONT, gameFooter, MEDIUM, rootStyle, text } from '../theme';

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
const TEAM1_TOP = 224;
const TEAM2_TOP = 620;
const SECTION_H = 372;
const ROWS_TOP_OFFSET = 80;
const ROWS_BOTTOM_PAD = 16;
const FOOTER_Y = 1008;

function header(input: StartTemplateInput): VNode[] {
  const ranked = input.isRanked === true;

  return [
    text(X, 34, 420, 32, `GAME #${input.gameId}`, 32, COLORS.muted, MEDIUM, 'left', 0.8),
    text(WIDTH - X - 420, ranked ? 18 : 24, 420, 34, ranked ? 'Ranked' : 'Unranked', 28, COLORS.muted, MEDIUM, 'right', 1.1),
    ranked
      ? text(WIDTH - X - 420, 50, 420, 28, `Queue ${input.minElo ?? 0} - ${input.maxElo ?? 0}`, 24, COLORS.faint, MEDIUM, 'right', 0.7)
      : null,
    text(X, 84, 1300, 78, 'MATCH START', 72, COLORS.text, MEDIUM, 'left', 0.5),
    text(X, 164, 1100, 30, `${input.mapName} · ${input.modeLabel}`, 24, COLORS.cyan, MEDIUM, 'left', 0.8),
    divider(X, 198, W, COLORS.line, 1),
  ].filter(Boolean) as VNode[];
}

function playerRow(
  player: StartTemplatePlayer,
  top: number,
  rowH: number,
): VNode[] {
  const avatarSize = Math.max(24, Math.min(44, rowH - 8));
  const nameSize = Math.max(20, Math.min(38, rowH - 6));
  const eloSize = Math.max(20, Math.min(34, rowH - 4));
  const tagSize = Math.max(22, Math.min(28, rowH - 6));
  const rowY = top + (rowH - avatarSize) / 2;

  return [
    avatar(player.avatar, X, rowY, avatarSize, 8),

    text(X + 56, top, 860, rowH, player.username, nameSize, COLORS.text, MEDIUM),

    player.isCaptain
      ? text(X + 940, top, 100, rowH, 'CPT', tagSize, COLORS.gold, MEDIUM, 'left', 1)
      : null,

    text(
      X + W - 280, top, 280, rowH,
      String(player.elo),
      eloSize, COLORS.text, MEDIUM, 'right',
    ),
  ].filter(Boolean) as VNode[];
}

function teamSection(
  players: StartTemplatePlayer[],
  top: number,
  title: string,
  avg: number,
  color: string,
): VNode[] {
  const rowsTop = top + ROWS_TOP_OFFSET;
  const rowsAvailable = SECTION_H - ROWS_TOP_OFFSET - ROWS_BOTTOM_PAD;
  const maxRows = Math.max(1, players.length);
  const rowH = Math.max(32, Math.min(84, Math.floor(rowsAvailable / maxRows)));

  const rows = players.flatMap((player, index) =>
    playerRow(player, rowsTop + index * rowH, rowH),
  );

  const empty = players.length === 0
    ? [text(X, rowsTop, W, rowH, 'NO PLAYERS', 22, COLORS.faint, MEDIUM, 'left', 1.2)]
    : [];

  return [
    text(X, top, 700, 64, title, 54, color, MEDIUM, 'left', 0.4),
    text(X + W - 420, top + 8, 420, 36, `AVG ${avg}`, 32, COLORS.text, MEDIUM, 'right', 0.4),
    ...rows,
    ...empty,
  ];
}

export function startTemplate(input: StartTemplateInput): { root: VNode; width: number; height: number } {
  const root = h('div', { style: rootStyle(WIDTH, HEIGHT) },
    ...header(input),
    ...teamSection(input.team1, TEAM1_TOP, 'TEAM GREEN', input.team1Avg, COLORS.green),
    ...teamSection(input.team2, TEAM2_TOP, 'TEAM RED', input.team2Avg, COLORS.red),
    gameFooter(WIDTH, input.serverName, input.inviteLink, FOOTER_Y),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
