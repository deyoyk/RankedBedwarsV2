import { h, VNode } from '../renderer';

export type ThemeName = 'deyo' | 'elite' | 'lunar' | 'rich' | 'y2k';

export type ThemeRecentGame = {
  label: string;
  color: string;
};

export type ThemeTemplateInput = {
  theme: string;
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

type ThemeStyle = {
  rootFrom: string;
  rootTo: string;
  card: string;
  inset: string;
  badgeBg: string;
  badgeText: string;
  grain: number;
  stars: boolean;
};

const STYLES: Record<ThemeName, ThemeStyle> = {
  elite: { rootFrom: '#262626', rootTo: '#101010', card: '#0d0d0d', inset: '#000000', badgeBg: '#a63fb5', badgeText: '#ffffff', grain: 0.05, stars: false },
  deyo: { rootFrom: '#4a4438', rootTo: '#201c15', card: '#171410', inset: '#000000', badgeBg: '#e8e4da', badgeText: '#2a2620', grain: 0.08, stars: false },
  lunar: { rootFrom: '#8c2b23', rootTo: '#3d0f0c', card: '#200d0b', inset: '#0d0505', badgeBg: '#ff6f61', badgeText: '#ffffff', grain: 0.07, stars: false },
  rich: { rootFrom: '#3b1163', rootTo: '#150422', card: '#1c0a2e', inset: '#0d0316', badgeBg: '#d4af37', badgeText: '#3a2a00', grain: 0.06, stars: false },
  y2k: { rootFrom: '#1c1c06', rootTo: '#050505', card: '#101010', inset: '#000000', badgeBg: '#111111', badgeText: '#f5f36b', grain: 0.09, stars: true },
};

function styleFor(theme: string): ThemeStyle {
  return STYLES[(theme.toLowerCase() as ThemeName)] || STYLES.elite;
}

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

function card(left: number, top: number, width: number, height: number, bg: string): VNode {
  return h('div', { style: { position: 'absolute', left, top, width, height, backgroundColor: bg, borderRadius: 24 } });
}

function grainOverlay(opacity: number): VNode {
  return h('svg', { width: WIDTH, height: HEIGHT, style: { position: 'absolute', left: 0, top: 0 } },
    h('filter', { id: 'themegrain' },
      h('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2' }),
      h('feColorMatrix', { type: 'saturate', values: '0' })),
    h('rect', { width: WIDTH, height: HEIGHT, filter: 'url(#themegrain)', opacity: String(opacity) }));
}

function star(cx: number, cy: number, size: number, color: string): VNode {
  const s = size / 2;
  return h('svg', { width: size, height: size, style: { position: 'absolute', left: Math.round(cx - s), top: Math.round(cy - s) } },
    h('polygon', { points: `${s},0 ${s * 1.25},${s * 0.75} ${size},${s} ${s * 1.25},${s * 1.25} ${s},${size} ${s * 0.75},${s * 1.25} 0,${s} ${s * 0.75},${s * 0.75}`, fill: color }));
}

function recentColumn(games: ThemeRecentGame[], left: number): VNode[] {
  return games.map((g, i) =>
    h('div', {
      style: { position: 'absolute', left, top: 455 + i * 28, fontFamily: 'PoppinsRegular', fontSize: 24, color: g.color },
    }, g.label)
  );
}

export function themeTemplate(input: ThemeTemplateInput): { root: VNode; width: number; height: number } {
  const st = styleFor(input.theme);
  const ignSize = input.ign.length <= 10 ? 34 : 20;
  const root = h('div', {
    style: {
      display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT,
      backgroundImage: `linear-gradient(135deg, ${st.rootFrom} 0%, ${st.rootTo} 100%)`,
    },
  },
    grainOverlay(st.grain),
    card(95, 70, 250, 558, st.card),
    card(443, 70, 234, 298, st.card),
    card(703, 70, 234, 298, st.card),
    card(963, 70, 234, 298, st.card),
    card(443, 398, 234, 230, st.card),
    card(703, 398, 494, 230, st.card),
    card(414, 289, 206, 70, st.inset),
    card(677, 289, 206, 70, st.inset),
    card(940, 289, 206, 70, st.inset),
    input.skin ? h('img', { src: input.skin, width: 250, height: 420, style: { position: 'absolute', left: 105, top: 110, borderRadius: 16 } }) : null,
    h('div', {
      style: {
        position: 'absolute', left: 104, top: 494, width: 92, height: 44, borderRadius: 12,
        backgroundColor: st.badgeBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'ADAMCGPRO', fontSize: 28, color: st.badgeText,
      },
    }, input.theme.toUpperCase()),
    h('div', { style: { position: 'absolute', left: 104, top: 542, width: 232, height: 84, backgroundColor: '#000000', borderRadius: 20 } }),
    h('div', { style: { position: 'absolute', left: 116, top: 551, width: 66, height: 66, backgroundColor: '#1a1a1a', borderRadius: 33 } }),
    centered(245, 584, ignSize, 'ADAMCGPRO', '#FFFFFF', input.ign, 190),
    centered(640, 40, 40, 'ADAMCGPRO', '#FFFFFF', input.serverName, 800),
    centered(640, 660, 24, 'PoppinsRegular', '#FFFFFF', input.inviteLink, 800),
    centered(517, 130, 36, 'ADAMCGPRO', '#FFFFFF', 'WINS', 200),
    centered(780, 130, 36, 'ADAMCGPRO', '#FFFFFF', 'POS.', 200),
    centered(1047, 130, 36, 'ADAMCGPRO', '#FFFFFF', 'MVPS', 200),
    centered(517, 425, 36, 'ADAMCGPRO', '#FFFFFF', 'RATING', 200),
    centered(950, 425, 36, 'ADAMCGPRO', '#FFFFFF', 'RECENT GAMES', 500),
    centered(517, 208, 85, 'ADAMCGPRO', '#FFFFFF', input.wins),
    centered(780, 208, 85, 'ADAMCGPRO', '#FFFFFF', input.rank),
    centered(1047, 208, 85, 'ADAMCGPRO', '#FFFFFF', input.mvps),
    centered(517, 518, 85, 'ADAMCGPRO', '#FFFFFF', input.rating),
    centered(517, 324, 30, 'PoppinsMedium', '#FFFFFF', input.wlr, 200),
    centered(1047, 324, 30, 'PoppinsMedium', '#FFFFFF', input.mvpRate, 200),
    h('svg', { width: 20, height: 14, style: { position: 'absolute', left: 692, top: 313 } },
      h('polygon', { points: '2,12 10,2 18,12', fill: '#FFFFFF' })),
    centered(795, 322, 30, 'PoppinsMedium', '#FFFFFF', 'MAX RANK', 300),
    ...recentColumn(input.recent.slice(0, 5), 730),
    ...recentColumn(input.recent.slice(5, 10), 975),
    st.stars ? star(1120, 90, 56, '#cfe8ff') : null,
    st.stars ? star(90, 620, 64, '#e8c85a') : null,
  );
  return { root, width: WIDTH, height: HEIGHT };
}
