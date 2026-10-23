import { h, VNode } from '../renderer';

export type ScoreTemplatePlayer = {
  username: string;
  elo_before: number;
  elo_after: number;
  oldElo?: number;
  newElo?: number;
  mvp: boolean;
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
const NAME_FONT = 'ADAMCGPRO';
const ROW_H = 93;
const CARD_X = 185;

function eloChangeText(p: ScoreTemplatePlayer): string {
  const before = p.elo_before ?? p.oldElo ?? 0;
  const after = p.elo_after ?? p.newElo ?? 0;
  const delta = after - before;
  return `${delta >= 0 ? '+' : ''}${delta}`;
}

function eloColumn(top: number, left: number, text: string, color: string): VNode {
  return h('div', {
    style: {
      position: 'absolute', left, top, width: 240,
      textAlign: 'center', fontFamily: NAME_FONT, fontSize: 40, color, lineHeight: '46px',
    },
  }, text);
}

function grain(): VNode {
  return h('svg', { width: WIDTH, height: HEIGHT, style: { position: 'absolute', left: 0, top: 0 } },
    h('filter', { id: 'scoregrain' },
      h('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.8', numOctaves: '2' }),
      h('feColorMatrix', { type: 'saturate', values: '0' })),
    h('rect', { width: WIDTH, height: HEIGHT, filter: 'url(#scoregrain)', opacity: '0.05' }));
}

function row(p: ScoreTemplatePlayer, top: number, band: string): VNode[] {
  const y = top + 24;
  return [
    h('div', { style: { position: 'absolute', left: 0, top, width: WIDTH, height: ROW_H, backgroundColor: band } }),
    h('img', { src: p.avatar, width: 40, height: 40, style: { position: 'absolute', left: CARD_X, top: y + 3, borderRadius: 8 } }),
    h('div', { style: { position: 'absolute', left: CARD_X + 58, top: y, display: 'flex', flexDirection: 'row', alignItems: 'center', height: 46 } },
      h('div', { style: { fontFamily: NAME_FONT, fontSize: 40, color: '#FFFFFF', lineHeight: '46px' } }, p.username),
      p.mvp ? h('div', {
        style: {
          marginLeft: 12, backgroundColor: '#000000', borderRadius: 10,
          paddingLeft: 16, paddingRight: 16, paddingTop: 4, paddingBottom: 4,
          fontFamily: NAME_FONT, fontSize: 36, color: '#FFFFFF', lineHeight: '40px',
        },
      }, 'MVP') : null,
    ),
    eloColumn(y, CARD_X + 1010, eloChangeText(p), '#FFFFFF'),
    eloColumn(y, CARD_X + 1171, String(p.elo_before ?? p.oldElo ?? 0), '#757474'),
    eloColumn(y, CARD_X + 1379, String(p.elo_after ?? p.newElo ?? 0), '#FFFFFF'),
  ];
}

function teamCard(players: ScoreTemplatePlayer[], top: number): VNode[] {
  return players.flatMap((p, i) => row(p, top + i * ROW_H, i % 2 === 0 ? 'rgba(38,48,140,0.55)' : 'rgba(12,16,48,0.55)'));
}

export function scoreTemplate(input: ScoreTemplateInput): { root: VNode; width: number; height: number } {
  const root = h('div', {
    style: {
      display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT,
      backgroundImage: 'linear-gradient(180deg, #070b1d 0%, #131a3f 55%, #070b1d 100%)',
    },
  },
    grain(),
    h('div', { style: { position: 'absolute', left: 120, top: 45, fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, `GAME #${input.gameId}`),
    input.serverName ? h('div', { style: { position: 'absolute', left: 120, top: 952, fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, input.serverName) : null,
    input.inviteLink ? h('div', { style: { position: 'absolute', left: 1200, top: 952, width: 640, textAlign: 'center', fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, input.inviteLink) : null,
    ...teamCard(input.winners, 170),
    ...teamCard(input.losers, 600),
  );
  return { root, width: WIDTH, height: HEIGHT };
}
