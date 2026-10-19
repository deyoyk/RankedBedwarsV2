import { h, VNode } from '../renderer';

export type ScoreTemplatePlayer = {
  username: string;
  oldElo: number;
  newElo: number;
  mvp: boolean;
  avatar: string;
};

export type ScoreTemplateInput = {
  gameId: number;
  winners: ScoreTemplatePlayer[];
  losers: ScoreTemplatePlayer[];
  serverName: string;
  inviteLink: string;
  bg: string;
  mvpBadge: string;
};

const WIDTH = 1920;
const HEIGHT = 1080;
const NAME_FONT = 'ADAMCGPRO';

function eloChangeText(p: ScoreTemplatePlayer): string {
  const delta = p.newElo - p.oldElo;
  return `${delta >= 0 ? '+' : ''}${delta}`;
}

function eloColumn(left: number, text: string, color: string): VNode {
  return h('div', {
    style: {
      position: 'absolute', left, top: 0, width: 240,
      textAlign: 'center', fontFamily: NAME_FONT, fontSize: 40, color, lineHeight: '46px',
    },
  }, text);
}

function row(p: ScoreTemplatePlayer, top: number, mvpBadge: string): VNode {
  return h('div', { style: { display: 'flex', position: 'absolute', left: 0, top, width: WIDTH, height: 46 } },
    h('img', { src: p.avatar, width: 40, height: 40, style: { position: 'absolute', left: 185, top: 0 } }),
    h('div', { style: { position: 'absolute', left: 243, top: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', height: 46 } },
      h('div', { style: { fontFamily: NAME_FONT, fontSize: 40, color: '#FFFFFF', lineHeight: '46px' } }, p.username),
      p.mvp ? h('img', { src: mvpBadge, width: 148, height: 57, style: { marginLeft: 10 } }) : null,
    ),
    eloColumn(1195, eloChangeText(p), '#FFFFFF'),
    eloColumn(1356, String(p.oldElo), '#757474'),
    eloColumn(1564, String(p.newElo), '#FFFFFF'),
  );
}

function teamCard(players: ScoreTemplatePlayer[], top: number, mvpBadge: string): VNode[] {
  return players.map((p, i) => row(p, top + i * 93, mvpBadge));
}

export function scoreTemplate(input: ScoreTemplateInput): { root: VNode; width: number; height: number } {
  const root = h('div', {
    style: {
      display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT,
      backgroundImage: `url(${input.bg})`, backgroundSize: '1920px 1080px',
    },
  },
    h('div', { style: { position: 'absolute', left: 120, top: 45, fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, `GAME #${input.gameId}`),
    input.serverName ? h('div', { style: { position: 'absolute', left: 120, top: 952, fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, input.serverName) : null,
    input.inviteLink ? h('div', { style: { position: 'absolute', left: 1200, top: 952, width: 640, textAlign: 'center', fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, input.inviteLink) : null,
    ...teamCard(input.winners, 170, input.mvpBadge),
    ...teamCard(input.losers, 600, input.mvpBadge),
  );
  return { root, width: WIDTH, height: HEIGHT };
}
