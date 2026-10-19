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
const PANEL = '#101014';
const LINE = '#26262e';
const MUTED = '#8a8a95';

function diamond(cx: number, cy: number, size: number, color: string): VNode {
  const s = size / 2;
  return h('svg', { width: size, height: size, style: { position: 'absolute', left: Math.round(cx - s), top: Math.round(cy - s) } },
    h('polygon', { points: `${s},0 ${size},${s} ${s},${size} 0,${s}`, fill: color }));
}

function grain(): VNode {
  return h('svg', { width: WIDTH, height: HEIGHT, style: { position: 'absolute', left: 0, top: 0 } },
    h('filter', { id: 'defaultgrain' },
      h('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2' }),
      h('feColorMatrix', { type: 'saturate', values: '0' })),
    h('rect', { width: WIDTH, height: HEIGHT, filter: 'url(#defaultgrain)', opacity: '0.04' }));
}

function emblem(): VNode {
  return h('svg', { width: 110, height: 110, style: { position: 'absolute', left: 1005, top: 55 } },
    h('polygon', { points: '28,40 2,28 2,82', fill: '#a5f3fc' }),
    h('polygon', { points: '82,40 108,28 108,82', fill: '#a5f3fc' }),
    h('polygon', { points: '55,5 105,55 55,105 5,55', fill: '#00e5ff' }),
    h('polygon', { points: '55,24 86,55 55,86 24,55', fill: '#ffffff' }),
    h('polygon', { points: '55,38 72,55 55,72 38,55', fill: '#00e5ff' }));
}

function rightText(left: number, top: number, width: number, fontSize: number, font: string, color: string, text: string, height?: number): VNode {
  return h('div', {
    style: {
      position: 'absolute', left, top, width, height: height ?? fontSize,
      textAlign: 'right', fontFamily: font, fontSize, color, lineHeight: `${height ?? fontSize}px`,
    },
  }, text);
}

function statTile(x: number, y: number, t: DefaultTile): VNode {
  return h('div', {
    style: {
      position: 'absolute', left: x, top: y, width: 300, height: 125,
      backgroundColor: PANEL, borderRadius: 12, overflow: 'hidden',
      borderWidth: 1, borderStyle: 'solid', borderColor: LINE,
    },
  },
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: 300, height: 4, backgroundColor: t.accent } }),
    h('div', { style: { position: 'absolute', left: 25, top: 20, fontFamily: 'PoppinsMedium', fontSize: 54, color: '#FFFFFF', lineHeight: '56px' } }, t.value),
    h('div', { style: { position: 'absolute', left: 25, top: 88, fontFamily: 'PoppinsRegular', fontSize: 19, color: MUTED } }, t.label),
    h('div', {
      style: {
        position: 'absolute', right: 12, top: 14, width: 76, height: 30, borderRadius: 6,
        backgroundColor: '#241d4d', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'PoppinsMedium', fontSize: 18, color: '#a78bfa',
      },
    }, t.rank),
  );
}

function combatTile(x: number, t: DefaultTile): VNode {
  return h('div', {
    style: {
      position: 'absolute', left: x, top: 794, width: 384, height: 68,
      backgroundColor: PANEL, borderRadius: 10, overflow: 'hidden',
      borderWidth: 1, borderStyle: 'solid', borderColor: LINE,
    },
  },
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: 384, height: 3, backgroundColor: '#8b5cf6' } }),
    h('div', { style: { position: 'absolute', left: 20, top: 8, fontFamily: 'PoppinsMedium', fontSize: 36, color: '#FFFFFF', lineHeight: '38px' } }, t.value),
    h('div', { style: { position: 'absolute', left: 20, top: 46, fontFamily: 'PoppinsRegular', fontSize: 15, color: MUTED } }, t.label),
    h('div', {
      style: {
        position: 'absolute', right: 12, top: 10, width: 72, height: 28, borderRadius: 6,
        backgroundColor: '#241d4d', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'PoppinsMedium', fontSize: 17, color: '#a78bfa',
      },
    }, t.rank),
  );
}

export function defaultTemplate(input: DefaultTemplateInput): { root: VNode; width: number; height: number } {
  const barW = 1140;
  const greenW = Math.round(barW * Math.min(1, Math.max(0, input.winRate)));
  const ignSize = input.ign.length <= 12 ? 62 : 44;
  const tileXs = [70, 390, 710, 1030];
  const root = h('div', {
    style: {
      display: 'flex', position: 'relative', width: WIDTH, height: HEIGHT, backgroundColor: '#0a0a0f',
    },
  },
    grain(),
    h('div', { style: { position: 'absolute', left: 70, top: 35, width: 150, height: 150, borderRadius: 8, overflow: 'hidden', backgroundColor: '#15151c' } },
      input.skin ? h('img', { src: input.skin, width: 150, height: 330, style: { position: 'absolute', left: 0, top: -55 } }) : null),
    h('div', {
      style: {
        position: 'absolute', left: 100, top: 158, width: 110, height: 36, borderRadius: 8,
        backgroundColor: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'PoppinsMedium', fontSize: 22, color: '#FFFFFF',
      },
    }, `LVL ${input.level}`),
    h('div', { style: { position: 'absolute', left: 270, top: 55, fontFamily: 'PoppinsMedium', fontSize: ignSize, color: '#d7d7de', lineHeight: '64px' } }, input.ign),
    input.joined ? h('div', { style: { position: 'absolute', left: 270, top: 132, fontFamily: 'PoppinsRegular', fontSize: 22, color: MUTED } }, input.joined) : null,
    h('div', { style: { position: 'absolute', left: 270, top: 178, fontFamily: 'PoppinsMedium', fontSize: 18, color: '#8b5cf6' } }, 'LEVEL PROGRESS'),
    rightText(550, 176, 200, 18, 'PoppinsRegular', MUTED, `${input.xpToNext} XP TO NEXT`, 24),
    h('div', { style: { position: 'absolute', left: 270, top: 204, width: 480, height: 8, borderRadius: 4, backgroundColor: LINE } }),
    h('div', { style: { position: 'absolute', left: 270, top: 204, width: Math.round(480 * Math.min(1, Math.max(0, input.xpProgress))), height: 8, borderRadius: 4, backgroundColor: '#8b5cf6' } }),
    emblem(),
    rightText(1120, 62, 210, 62, 'PoppinsMedium', '#00e5ff', `${input.elo} RR`, 66),
    rightText(1120, 134, 210, 22, 'PoppinsRegular', MUTED, `#${input.globalRank} GLOBAL`, 26),
    h('div', {
      style: {
        position: 'absolute', left: 70, top: 250, width: 1260, height: 190,
        backgroundColor: PANEL, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', borderColor: LINE,
      },
    }),
    diamond(108, 280, 16, '#8b5cf6'),
    h('div', { style: { position: 'absolute', left: 124, top: 268, fontFamily: 'PoppinsMedium', fontSize: 20, color: MUTED } }, 'RECORD'),
    h('div', { style: { position: 'absolute', left: 100, top: 295, fontFamily: 'PoppinsMedium', fontSize: 64, color: '#00e676', lineHeight: '66px' } }, input.wins),
    h('div', { style: { position: 'absolute', left: 100, top: 366, fontFamily: 'PoppinsRegular', fontSize: 20, color: MUTED } }, 'WINS'),
    rightText(1150, 295, 150, 64, 'PoppinsMedium', '#ff5252', input.losses, 66),
    rightText(1150, 366, 150, 20, 'PoppinsRegular', MUTED, 'LOSSES', 24),
    h('div', { style: { position: 'absolute', left: 100, top: 394, width: barW, height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: LINE } },
      h('div', { style: { position: 'absolute', left: 0, top: 0, width: greenW, height: 12, backgroundColor: '#00c853' } }),
      h('div', { style: { position: 'absolute', right: 0, top: 0, width: barW - greenW, height: 12, backgroundColor: '#ff5252' } })),
    h('div', {
      style: {
        position: 'absolute', left: 340, top: 412, width: 600, height: 24, textAlign: 'center',
        fontFamily: 'PoppinsRegular', fontSize: 20, color: MUTED, lineHeight: '24px',
      },
    }, input.winCaption),
    ...input.tiles.slice(0, 4).map((t, i) => statTile(tileXs[i], 465, t)),
    ...input.tiles.slice(4, 8).map((t, i) => statTile(tileXs[i], 610, t)),
    h('div', {
      style: {
        position: 'absolute', left: 70, top: 755, width: 1260, height: 115,
        backgroundColor: PANEL, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', borderColor: LINE,
      },
    }),
    diamond(108, 776, 16, '#8b5cf6'),
    h('div', { style: { position: 'absolute', left: 124, top: 764, fontFamily: 'PoppinsMedium', fontSize: 20, color: MUTED } }, 'COMBAT'),
    ...[100, 496, 892].map((x, i) => combatTile(x, input.combat[i] || { value: '-', label: '', rank: '' })),
    h('div', { style: { position: 'absolute', left: 70, top: 888, fontFamily: 'PoppinsMedium', fontSize: 20, color: MUTED } }, input.seasonLine1),
    h('div', { style: { position: 'absolute', left: 70, top: 910, fontFamily: 'PoppinsRegular', fontSize: 18, color: '#55555e' } }, input.seasonLine2),
    h('div', { style: { position: 'absolute', left: 1140, top: 886, fontFamily: 'PoppinsMedium', fontSize: 36, color: '#55555e' } }, 'R'),
    h('div', { style: { position: 'absolute', left: 1180, top: 894, fontFamily: 'PoppinsMedium', fontSize: 26, color: '#55555e' } }, 'RBW.GG'),
  );
  return { root, width: WIDTH, height: HEIGHT };
}
