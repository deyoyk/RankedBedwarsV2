import { h, VNode } from '../renderer';

export type ThemeRecentGame = {
  label: string;
  color: string;
};

export type ThemeTemplateInput = {
  bg: string;
  serverName: string;
  inviteLink: string;
  ign: string;
  skin: string | null;
  wins: string;
  rank: string;
  mvps: string;
  rating: string;
  wlr: string;
  mvpRate: string;
  recent: ThemeRecentGame[];
};

const WIDTH = 1240;
const HEIGHT = 698;

function centered(cx: number, cy: number, fontSize: number, font: string, color: string, text: string, width = 220): VNode {
  return h('div', {
    style: {
      position: 'absolute', left: Math.round(cx - width / 2), top: Math.round(cy - fontSize / 2),
      width, height: fontSize, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: font, fontSize, color,
    },
  }, text);
}

function recentColumn(games: ThemeRecentGame[], left: number): VNode[] {
  return games.map((g, i) =>
    h('div', {
      style: { position: 'absolute', left, top: 455 + i * 28, fontFamily: 'PoppinsRegular', fontSize: 24, color: g.color },
    }, g.label)
  );
}

export function themeTemplate(input: ThemeTemplateInput): { root: VNode; width: number; height: number } {
  const ignSize = input.ign.length <= 10 ? 34 : 20;
  const root = h('div', {
    style: {
      display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT,
      backgroundImage: `url(${input.bg})`, backgroundSize: '1240px 698px',
    },
  },
    centered(640, 40, 40, 'ADAMCGPRO', '#FFFFFF', input.serverName, 800),
    centered(640, 660, 24, 'PoppinsRegular', '#FFFFFF', input.inviteLink, 800),
    centered(258, 574, ignSize, 'ADAMCGPRO', '#FFFFFF', input.ign, 400),
    input.skin ? h('img', { src: input.skin, width: 250, height: 420, style: { position: 'absolute', left: 105, top: 110 } }) : null,
    centered(517, 208, 85, 'ADAMCGPRO', '#FFFFFF', input.wins),
    centered(780, 208, 85, 'ADAMCGPRO', '#FFFFFF', input.rank),
    centered(1047, 208, 85, 'ADAMCGPRO', '#FFFFFF', input.mvps),
    centered(517, 518, 85, 'ADAMCGPRO', '#FFFFFF', input.rating),
    centered(517, 329, 30, 'PoppinsMedium', '#FFFFFF', input.wlr, 300),
    centered(1047, 329, 30, 'PoppinsMedium', '#FFFFFF', input.mvpRate, 300),
    h('svg', { width: 20, height: 14, style: { position: 'absolute', left: 692, top: 313 } },
      h('polygon', { points: '2,12 10,2 18,12', fill: '#FFFFFF' })),
    centered(795, 322, 30, 'PoppinsMedium', '#FFFFFF', 'MAX RANK', 300),
    ...recentColumn(input.recent.slice(0, 5), 730),
    ...recentColumn(input.recent.slice(5, 10), 975),
  );
  return { root, width: WIDTH, height: HEIGHT };
}
