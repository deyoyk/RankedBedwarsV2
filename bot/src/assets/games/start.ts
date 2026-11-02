import { h, VNode } from '../renderer';

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
const NAME_FONT = 'ADAMCGPRO';
const CARD_W = 800;
const CARD_X1 = 80;
const CARD_X2 = 1040;
const CARD_TOP = 260;
const HEADER_H = 96;
const ROW_H = 84;

function grain(): VNode {
  return h('svg', { width: WIDTH, height: HEIGHT, style: { position: 'absolute', left: 0, top: 0 } },
    h('filter', { id: 'startgrain' },
      h('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.8', numOctaves: '2' }),
      h('feColorMatrix', { type: 'saturate', values: '0' })),
    h('rect', { width: WIDTH, height: HEIGHT, filter: 'url(#startgrain)', opacity: '0.05' }));
}

function teamCard(title: string, avg: number, players: StartTemplatePlayer[], left: number, accent: string): VNode[] {
  const rows = players.flatMap((p, i) => {
    const top = CARD_TOP + HEADER_H + i * ROW_H;
    const y = top + 22;
    return [
      h('div', { style: { position: 'absolute', left, top, width: CARD_W, height: ROW_H, backgroundColor: i % 2 === 0 ? 'rgba(38,48,140,0.55)' : 'rgba(12,16,48,0.55)' } }),
      h('img', { src: p.avatar, width: 40, height: 40, style: { position: 'absolute', left: left + 24, top: y, borderRadius: 8 } }),
      h('div', { style: { position: 'absolute', left: left + 82, top: y - 2, display: 'flex', flexDirection: 'row', alignItems: 'center', height: 46 } },
        h('div', { style: { fontFamily: NAME_FONT, fontSize: 38, color: '#FFFFFF', lineHeight: '44px' } }, p.username),
        p.isCaptain ? h('div', {
          style: {
            marginLeft: 12, backgroundColor: '#000000', borderRadius: 10,
            paddingLeft: 14, paddingRight: 14, paddingTop: 3, paddingBottom: 3,
            fontFamily: NAME_FONT, fontSize: 30, color: '#FFD54A', lineHeight: '36px',
          },
        }, 'CPT') : null,
      ),
      h('div', { style: { position: 'absolute', left: left + CARD_W - 220, top: y, width: 196, textAlign: 'right', fontFamily: NAME_FONT, fontSize: 38, color: '#B9B9C7', lineHeight: '44px' } }, String(p.elo)),
    ];
  });
  return [
    h('div', { style: { position: 'absolute', left, top: CARD_TOP, width: CARD_W, height: HEADER_H, backgroundColor: accent } }),
    h('div', { style: { position: 'absolute', left: left + 24, top: CARD_TOP + 14, fontFamily: NAME_FONT, fontSize: 40, color: '#FFFFFF', lineHeight: '46px' } }, title),
    h('div', { style: { position: 'absolute', left: left + CARD_W - 324, top: CARD_TOP + 14, width: 300, textAlign: 'right', fontFamily: NAME_FONT, fontSize: 40, color: '#FFFFFF', lineHeight: '46px' } }, `AVG ${avg}`),
    ...rows,
  ];
}

export function startTemplate(input: StartTemplateInput): { root: VNode; width: number; height: number } {
  const subtitle = `${input.mapName} · ${input.modeLabel}`;
  const root = h('div', {
    style: {
      display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT,
      backgroundImage: 'linear-gradient(180deg, #070b1d 0%, #131a3f 55%, #070b1d 100%)',
    },
  },
    grain(),
    h('div', { style: { position: 'absolute', left: 0, top: 40, width: WIDTH, textAlign: 'center', fontFamily: 'PoppinsLight', fontSize: 44, color: '#757474' } }, `GAME #${input.gameId}`),
    h('div', { style: { position: 'absolute', left: 0, top: 92, width: WIDTH, textAlign: 'center', fontFamily: NAME_FONT, fontSize: 72, color: '#FFFFFF', lineHeight: '78px' } }, 'MATCH START'),
    h('div', { style: { position: 'absolute', left: 0, top: 182, width: WIDTH, textAlign: 'center', fontFamily: NAME_FONT, fontSize: 40, color: '#8fd6ff', lineHeight: '46px' } }, subtitle),
    ...teamCard('TEAM GREEN', input.team1Avg, input.team1, CARD_X1, 'rgba(22,120,60,0.85)'),
    ...teamCard('TEAM RED', input.team2Avg, input.team2, CARD_X2, 'rgba(160,32,32,0.85)'),
    input.serverName ? h('div', { style: { position: 'absolute', left: 120, top: 952, fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, input.serverName) : null,
    input.inviteLink ? h('div', { style: { position: 'absolute', left: 1200, top: 952, width: 640, textAlign: 'center', fontFamily: 'PoppinsLight', fontSize: 54, color: '#757474' } }, input.inviteLink) : null,
  );
  return { root, width: WIDTH, height: HEIGHT };
}
