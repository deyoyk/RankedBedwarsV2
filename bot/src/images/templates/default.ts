import { h, VNode } from '../renderer';

export type DefaultTile = {
  value: string;
  label: string;
  accent: string;
  rank: string;
};

export type DefaultTemplateInput = {
  ign: string;
  joined: string;
  level: number;
  xpToNext: number;
  xpProgress: number;
  skin: string | null;
  elo: number;
  globalRank: number | string;
  wins: string;
  losses: string;
  winRate: number;
  winCaption: string;
  tiles: DefaultTile[];
  combat: DefaultTile[];
  seasonLine1: string;
  seasonLine2: string;
};

const WIDTH = 1400;
const HEIGHT = 940;
const PANEL = '#11141d';
const LINE = '#232936';
const MUTED = '#8a8a95';
const CYAN = '#22d3ee';

function grain(): VNode {
  return h('svg', { width: WIDTH, height: HEIGHT, style: { position: 'absolute', left: 0, top: 0 } },
    h('filter', { id: 'defaultgrain' },
      h('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2' }),
      h('feColorMatrix', { type: 'saturate', values: '0' })),
    h('rect', { width: WIDTH, height: HEIGHT, filter: 'url(#defaultgrain)', opacity: '0.05' }));
}

function diamond(cx: number, cy: number, size: number, color: string): VNode {
  const s = size / 2;
  return h('svg', { width: size, height: size, style: { position: 'absolute', left: Math.round(cx - s), top: Math.round(cy - s) } },
    h('polygon', { points: `${s},0 ${size},${s} ${s},${size} 0,${s}`, fill: color }));
}

function levelRing(progress: number, level: number, skin: string | null): VNode {
  const r = 78;
  const c = 2 * Math.PI * r;
  const filled = Math.round(c * Math.min(1, Math.max(0, progress)));
  return h('div', { style: { position: 'absolute', left: 70, top: 48, width: 180, height: 180 } },
    h('svg', { width: 180, height: 180, style: { position: 'absolute', left: 0, top: 0 } },
      h('circle', { cx: 90, cy: 90, r, fill: 'none', stroke: '#232936', strokeWidth: 10 }),
      h('circle', { cx: 90, cy: 90, r, fill: 'none', stroke: CYAN, strokeWidth: 10, strokeDasharray: `${filled} ${Math.round(c)}`, strokeLinecap: 'round', transform: 'rotate(-90 90 90)' })),
    h('div', { style: { position: 'absolute', left: 18, top: 18, width: 144, height: 144, borderRadius: 72, overflow: 'hidden', backgroundColor: '#15151c' } },
      skin ? h('img', { src: skin, width: 144, height: 345, style: { position: 'absolute', left: 0, top: 0 } }) : null),
    h('div', {
      style: {
        position: 'absolute', left: 45, top: 188 - 48, width: 90, height: 34, borderRadius: 17,
        backgroundColor: '#0e7490', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'PoppinsMedium', fontSize: 20, color: '#FFFFFF',
      },
    }, `LVL ${level}`));
}

function statTile(x: number, y: number, t: DefaultTile): VNode {
  return h('div', {
    style: {
      position: 'absolute', left: x, top: y, width: 300, height: 125,
      backgroundColor: PANEL, borderRadius: 12,
      borderWidth: 1, borderStyle: 'solid', borderColor: LINE,
    },
  },
    h('div', { style: { position: 'absolute', left: 0, top: 14, width: 5, height: 97, borderRadius: 3, backgroundColor: t.accent } }),
    h('div', { style: { position: 'absolute', left: 28, top: 18, fontFamily: 'PoppinsMedium', fontSize: 54, color: '#FFFFFF', lineHeight: '56px' } }, t.value),
    h('div', { style: { position: 'absolute', left: 28, top: 86, fontFamily: 'PoppinsRegular', fontSize: 19, color: MUTED } }, t.label),
    h('div', {
      style: {
        position: 'absolute', right: 14, top: 14, width: 74, height: 28, borderRadius: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderStyle: 'solid', borderColor: '#a78bfa',
        fontFamily: 'PoppinsMedium', fontSize: 17, color: '#a78bfa',
      },
    }, t.rank),
  );
}

function rightText(left: number, top: number, width: number, fontSize: number, font: string, color: string, text: string, height?: number): VNode {
  return h('div', {
    style: {
      position: 'absolute', left, top, width, height: height ?? fontSize,
      textAlign: 'right', fontFamily: font, fontSize, color, lineHeight: `${height ?? fontSize}px`,
    },
  }, text);
}

export function defaultTemplate(input: DefaultTemplateInput): { root: VNode; width: number; height: number } {
  const barW = 640;
  const greenW = Math.round(barW * Math.min(1, Math.max(0, input.winRate)));
  const ignSize = input.ign.length <= 12 ? 68 : 48;
  const tileXs = [70, 390, 710, 1030];
  const root = h('div', {
    style: {
      display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT,
      backgroundImage: `linear-gradient(160deg, #0d1226 0%, #0b0e17 55%, #07090f 100%)`,
    },
  },
    grain(),
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: WIDTH, height: 300, backgroundImage: `linear-gradient(180deg, rgba(34,211,238,0.07) 0%, rgba(34,211,238,0) 100%)` } }),
    levelRing(input.xpProgress, input.level, input.skin),
    h('div', { style: { position: 'absolute', left: 285, top: 62, fontFamily: 'PoppinsMedium', fontSize: ignSize, color: '#e8e8ef', lineHeight: '70px' } }, input.ign),
    input.joined ? h('div', { style: { position: 'absolute', left: 287, top: 140, fontFamily: 'PoppinsRegular', fontSize: 22, color: MUTED } }, input.joined) : null,
    h('div', { style: { position: 'absolute', left: 287, top: 182, fontFamily: 'PoppinsMedium', fontSize: 18, color: CYAN } }, 'LEVEL PROGRESS'),
    rightText(560, 180, 190, 18, 'PoppinsRegular', MUTED, `${input.xpToNext} XP TO NEXT`, 24),
    h('div', { style: { position: 'absolute', left: 287, top: 208, width: 463, height: 8, borderRadius: 4, backgroundColor: LINE } }),
    rightText(1115, 66, 215, 62, 'PoppinsMedium', CYAN, `${input.elo} RR`, 66),
    rightText(1115, 138, 215, 22, 'PoppinsRegular', MUTED, `#${input.globalRank} GLOBAL`, 26),
    h('div', {
      style: {
        position: 'absolute', left: 70, top: 268, width: 1260, height: 150,
        backgroundColor: 'rgba(17,20,29,0.85)', borderRadius: 14,
        borderWidth: 1, borderStyle: 'solid', borderColor: LINE,
      },
    }),
    diamond(108, 296, 16, CYAN),
    h('div', { style: { position: 'absolute', left: 124, top: 284, fontFamily: 'PoppinsMedium', fontSize: 20, color: MUTED } }, 'RECORD'),
    h('div', { style: { position: 'absolute', left: 100, top: 306, fontFamily: 'PoppinsMedium', fontSize: 60, color: '#00e676', lineHeight: '62px' } }, input.wins),
    h('div', { style: { position: 'absolute', left: 102, top: 372, fontFamily: 'PoppinsRegular', fontSize: 19, color: MUTED } }, input.wins === '1' ? 'WIN' : 'WINS'),
    rightText(1150, 306, 150, 60, 'PoppinsMedium', '#ff5252', input.losses, 62),
    h('div', { style: { position: 'absolute', left: 330, top: 318, width: barW, height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: LINE } },
      h('div', { style: { position: 'absolute', left: 0, top: 0, width: greenW, height: 12, borderRadius: 6, backgroundColor: '#00c853' } }),
      h('div', { style: { position: 'absolute', right: 0, top: 0, width: barW - greenW, height: 12, borderRadius: 6, backgroundColor: '#ff5252' } })),
    h('div', { style: { position: 'absolute', left: 430, top: 338, width: 440, textAlign: 'center', fontFamily: 'PoppinsRegular', fontSize: 19, color: MUTED } }, input.winCaption),
    h('div', { style: { position: 'absolute', left: 1150, top: 372, width: 150, textAlign: 'right', fontFamily: 'PoppinsRegular', fontSize: 19, color: MUTED } }, 'LOSSES'),
    ...input.tiles.slice(0, 4).map((t, i) => statTile(tileXs[i], 443, t)),
    ...input.tiles.slice(4, 8).map((t, i) => statTile(tileXs[i], 588, t)),
    h('div', {
      style: {
        position: 'absolute', left: 70, top: 738, width: 1260, height: 110,
        backgroundColor: 'rgba(17,20,29,0.85)', borderRadius: 14,
        borderWidth: 1, borderStyle: 'solid', borderColor: LINE,
      },
    }),
    diamond(108, 762, 15, CYAN),
    h('div', { style: { position: 'absolute', left: 124, top: 751, fontFamily: 'PoppinsMedium', fontSize: 19, color: MUTED } }, 'COMBAT'),
    ...[130, 520, 910].map((x, i) => {
      const t = input.combat[i] || { value: '-', label: '', rank: '' };
      return h('div', { style: { position: 'absolute', left: x, top: 786, width: 300 } },
        h('div', { style: { fontFamily: 'PoppinsMedium', fontSize: 40, color: '#FFFFFF', lineHeight: '42px' } }, t.value,
          h('span', { style: { marginLeft: 12, fontFamily: 'PoppinsRegular', fontSize: 18, color: MUTED } }, t.label)),
        h('div', {
          style: {
            position: 'absolute', right: 0, top: 6, width: 72, height: 28, borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderStyle: 'solid', borderColor: '#a78bfa',
            fontFamily: 'PoppinsMedium', fontSize: 17, color: '#a78bfa',
          },
        }, t.rank),
        i < 2 ? h('div', { style: { position: 'absolute', right: -45, top: 0, width: 1, height: 52, backgroundColor: LINE } }) : null,
      );
    }),
    h('div', { style: { position: 'absolute', left: 70, top: 872, fontFamily: 'PoppinsMedium', fontSize: 20, color: MUTED } }, input.seasonLine1),
    h('div', { style: { position: 'absolute', left: 70, top: 894, fontFamily: 'PoppinsRegular', fontSize: 18, color: '#55555e' } }, input.seasonLine2),
    h('div', { style: { position: 'absolute', left: 1140, top: 870, fontFamily: 'PoppinsMedium', fontSize: 36, color: '#55555e' } }, 'R'),
    h('div', { style: { position: 'absolute', left: 1180, top: 878, fontFamily: 'PoppinsMedium', fontSize: 26, color: '#55555e' } }, 'RBW.GG'),
  );
  return { root, width: WIDTH, height: HEIGHT };
}
