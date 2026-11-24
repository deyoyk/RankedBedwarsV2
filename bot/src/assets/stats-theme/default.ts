import { h, VNode } from '../renderer';
import { MEDIUM, SEMIBOLD } from '../theme';
import { staticImageDataUrl } from '../assets';
import { grainLayer } from '../grain';
import { DivisionTag, divisionTagBadge } from '../divisionTag';

export type MatchResult = 'win' | 'loss' | 'voided' | 'active' | 'unknown';

export type DefaultTemplateInput = {
  ign: string;
  skin: string | null;
  elo: number;
  rankName: string;
  rankColor: string;
  divisionTag?: DivisionTag | null;
  wins: string;
  losses: string;
  wlr: string;
  mvps: string;
  beds: string;
  streak: string;
  matches: MatchResult[];
  inviteLink: string;
  positions: {
    elo: string;
    wins: string;
    losses: string;
    wlr: string;
    mvps: string;
    beds: string;
    streak: string;
  };
};

const WIDTH = 1200;
const HEIGHT = 685;
const CARD_X = 30;
const CARD_Y = 30;
const CARD_W = WIDTH - CARD_X * 2;
const CARD_H = HEIGHT - CARD_Y * 2;
const CONTENT_X = 372;
const CONTENT_W = 760;
const SKIN_X = 55;
const SKIN_Y = 92;
const SKIN_W = 262;
const SKIN_H = 536;

const C = {
  page: '#C4C8CE',
  paper: '#FBF8FF',
  ink: '#1B1327',
  mute: '#56486A',
  line: '#1B132740',
  accent: '#7C3AED',
  onAccent: '#FFFFFF',
  unknownBar: '#BCBEC8',
  voidedBar: '#D9DBE2',
  winBar: '#2C854D',
  lossBar: '#C0392B',
  activeBar: '#E0B400',
};

const ICONS = {
  trophy: 'M232,60H212V48a12,12,0,0,0-12-12H56A12,12,0,0,0,44,48V60H24A20,20,0,0,0,4,80V96a44.05,44.05,0,0,0,44,44h.77A84.18,84.18,0,0,0,116,195.15V212H96a12,12,0,0,0,0,24h64a12,12,0,0,0,0-24H140V195.11c30.94-4.51,56.53-26.2,67-55.11h1a44.05,44.05,0,0,0,44-44V80A20,20,0,0,0,232,60ZM28,96V84H44v28c0,1.21,0,2.41.09,3.61A20,20,0,0,1,28,96Zm160,15.1c0,33.33-26.71,60.65-59.54,60.9A60,60,0,0,1,68,112V60H188ZM228,96a20,20,0,0,1-16.12,19.62c.08-1.5.12-3,.12-4.52V84h16Z',
  skull: 'M116,132a24,24,0,1,1-24-24A24,24,0,0,1,116,132Zm48-24a24,24,0,1,0,24,24A24,24,0,0,0,164,108Zm72,8c0,29.85-13.05,57.78-36,77.52V216a20,20,0,0,1-20,20H76a20,20,0,0,1-20-20V193.52c-23-19.74-36-47.67-36-77.52C20,58.65,68.45,12,128,12S236,58.65,236,116Zm-24,0c0-44.11-37.68-80-84-80S44,71.89,44,116c0,24.31,11.41,47,31.31,62.3A12,12,0,0,1,80,187.82V212H96V192a12,12,0,0,1,24,0v20h16V192a12,12,0,0,1,24,0v20h16V187.82a12,12,0,0,1,4.69-9.51C200.59,163,212,140.31,212,116Z',
  sword: 'M243.14,131.54l-32-80a12,12,0,0,0-13.73-7.25L140,57V40a12,12,0,0,0-24,0V62.37L53.4,76.29a12,12,0,0,0-8.54,7.25v0l0,0v0l-32,79.92A12,12,0,0,0,12,168c0,12.13,6.2,22.43,17.45,29A55,55,0,0,0,56,204a55,55,0,0,0,26.55-7C93.8,190.43,100,180.13,100,168a12,12,0,0,0-.86-4.46L72.38,96.65,116,87V204H104a12,12,0,0,0,0,24h48a12,12,0,0,0,0-24H140V81.63l40.42-9-23.56,58.9A12,12,0,0,0,156,136c0,12.13,6.2,22.43,17.45,29a53.78,53.78,0,0,0,53.1,0C237.8,158.43,244,148.13,244,136A12,12,0,0,0,243.14,131.54ZM56,180c-3.71,0-18-1.87-19.81-10.18L56,120.31l19.81,49.51C74,178.13,59.71,180,56,180Zm144-32c-3.71,0-18-1.87-19.81-10.18L200,88.31l19.81,49.51C218,146.13,203.71,148,200,148Z',
  crown: 'M252,80a32,32,0,1,0-60,15.45l-20.86,25.66L150.82,74.4a32,32,0,1,0-45.64,0L84.87,121.11,64,95.45a32,32,0,1,0-35,15.78l14,84.06A19.94,19.94,0,0,0,62.78,212H193.22A19.94,19.94,0,0,0,213,195.29l14-84.06A32.05,32.05,0,0,0,252,80Zm-32-8a8,8,0,1,1-8,8A8,8,0,0,1,220,72ZM128,44a8,8,0,1,1-8,8A8,8,0,0,1,128,44ZM36,72a8,8,0,1,1-8,8A8,8,0,0,1,36,72ZM189.83,188H66.17L55.29,122.78l23.4,28.79A12,12,0,0,0,88,156a12.87,12.87,0,0,0,1.63-.11,12,12,0,0,0,9.37-7.1L127.18,84l.82,0,.82,0L157,148.79a12,12,0,0,0,9.37,7.1A12.87,12.87,0,0,0,168,156a12,12,0,0,0,9.31-4.43l23.4-28.79Z',
  bed: 'M212,68H36V48a12,12,0,0,0-24,0V208a12,12,0,0,0,24,0V180H232v28a12,12,0,0,0,24,0V112A44.05,44.05,0,0,0,212,68ZM100,156H36V92h64Zm132,0H124V92h88a20,20,0,0,1,20,20Z',
  flame: 'M177.62,159.6a52,52,0,0,1-34,34,12.2,12.2,0,0,1-3.6.55,12,12,0,0,1-3.6-23.45,28,28,0,0,0,18.32-18.32,12,12,0,0,1,22.9,7.2ZM220,144a92,92,0,0,1-184,0c0-28.81,11.27-58.18,33.48-87.28a12,12,0,0,1,17.9-1.33L107.07,74.5,127,19.89a12,12,0,0,1,18.94-5.12C168.2,33.25,220,82.85,220,144Zm-24,0c0-41.71-30.61-78.39-52.52-99.29l-20.21,55.4a12,12,0,0,1-19.63,4.5L80.71,82.36C67,103.38,60,124.06,60,144a68,68,0,0,0,136,0Z',
};

function icon(path: string, size: number, color: string): VNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 256 256', fill: color, style: { display: 'block' } },
    h('path', { d: path }),
  );
}

function cell(label: string, value: string, iconPath: string, position: string): VNode {
  return h('div', {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: '18px 20px',
      backgroundColor: C.paper,
    },
  },
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        fontFamily: MEDIUM,
        fontSize: 15,
        letterSpacing: 1.2,
        lineHeight: '18px',
        color: C.mute,
      },
    },
      icon(iconPath, 18, C.mute),
      label,
      h('div', {
        style: {
          marginLeft: 'auto',
          fontFamily: MEDIUM,
          fontSize: 12,
          letterSpacing: 0.6,
          lineHeight: '18px',
          color: C.mute,
          transform: 'translateY(4px)',
        },
      }, position),
    ),
    h('div', {
      style: {
        fontFamily: SEMIBOLD,
        fontSize: 34,
        lineHeight: '38px',
        color: C.ink,
      },
    }, value),
  );
}

function matchBar(result: MatchResult): VNode {
  const backgroundColor = result === 'win'
    ? C.winBar
    : result === 'loss'
      ? C.lossBar
      : result === 'voided'
        ? C.voidedBar
        : result === 'active'
          ? C.activeBar
          : C.unknownBar;
  return h('div', {
    style: {
      flex: 1,
      height: 42,
      backgroundColor,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: C.line,
      transform: 'skewX(-20deg)',
    },
  });
}

function card(input: DefaultTemplateInput): VNode[] {
  const nameSize = input.ign.length > 12 ? 50 : 60;
  const inviteLabel = input.inviteLink.includes('.gg/')
    ? input.inviteLink.slice(input.inviteLink.lastIndexOf('.gg/'))
    : input.inviteLink;
  const buttonW = Math.max(180, Math.min(300, 100 + inviteLabel.length * 14));

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: CARD_X,
        top: CARD_Y,
        width: CARD_W,
        height: CARD_H,
        backgroundColor: C.paper,
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: C.ink,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: SKIN_X,
        top: SKIN_Y,
        width: SKIN_W,
        height: SKIN_H,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: C.line,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: SKIN_X + 10,
        top: SKIN_Y + 10,
        width: 20,
        height: 2,
        backgroundColor: C.mute,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: SKIN_X + 10,
        top: SKIN_Y + 10,
        width: 2,
        height: 20,
        backgroundColor: C.mute,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: SKIN_X + SKIN_W - 30,
        top: SKIN_Y + SKIN_H - 12,
        width: 20,
        height: 2,
        backgroundColor: C.mute,
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: SKIN_X + SKIN_W - 12,
        top: SKIN_Y + SKIN_H - 30,
        width: 2,
        height: 20,
        backgroundColor: C.mute,
      },
    }),
    input.skin
      ? h('img', {
        src: input.skin,
        width: 220,
        height: 472,
        style: {
          position: 'absolute',
          left: SKIN_X + 21,
          top: SKIN_Y + 40,
          width: 220,
          height: 472,
          objectFit: 'contain',
          filter: 'grayscale(1) contrast(1.08)',
        },
      })
      : h('div', {
        style: {
          position: 'absolute',
          left: SKIN_X + 56,
          top: SKIN_Y + 130,
          width: 150,
          height: 280,
          backgroundColor: '#D8CBE8',
        },
      }),

    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X,
        top: 66,
        width: CONTENT_W - 210,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
      },
    },
      h('div', {
        style: {
          fontFamily: SEMIBOLD,
          fontSize: nameSize,
          letterSpacing: -1.4,
          lineHeight: `${nameSize + 4}px`,
          color: C.ink,
          whiteSpace: 'nowrap',
        },
      }, input.ign),
      divisionTagBadge(input.divisionTag, 16),
    ),
    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X,
        top: 130,
        fontFamily: MEDIUM,
        fontSize: 18,
        letterSpacing: 1.4,
        color: C.mute,
      },
    }, `[  ${input.rankName.toUpperCase()}  ]`),

    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X + CONTENT_W - 190,
        top: 56,
        width: 190,
        textAlign: 'right',
        fontFamily: MEDIUM,
        fontSize: 14,
        letterSpacing: 2,
        color: C.mute,
      },
    }, 'ELO'),
    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X + CONTENT_W - 220,
        top: 78,
        width: 220,
        textAlign: 'right',
        fontFamily: SEMIBOLD,
        fontSize: 54,
        letterSpacing: -1.5,
        lineHeight: '60px',
        color: C.ink,
      },
    }, String(input.elo)),
    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X + CONTENT_W - 170,
        top: 144,
        width: 170,
        textAlign: 'right',
        fontFamily: SEMIBOLD,
        fontSize: 14,
        letterSpacing: 1,
        color: C.accent,
      },
    }, input.positions.elo),

    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X,
        top: 172,
        width: CONTENT_W,
        height: 2,
        backgroundColor: C.ink,
      },
    }),

    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X,
        top: 194,
        width: CONTENT_W,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        backgroundColor: C.line,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: C.line,
        borderTopWidth: 5,
        borderTopColor: C.accent,
      },
    },
      h('div', { style: { display: 'flex', flexDirection: 'row', gap: 1, height: 124 } },
        cell('WINS', input.wins, ICONS.trophy, input.positions.wins),
        cell('LOSSES', input.losses, ICONS.skull, input.positions.losses),
        cell('W/L', input.wlr, ICONS.sword, input.positions.wlr),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'row', gap: 1, height: 124 } },
        cell('MVPS', input.mvps, ICONS.crown, input.positions.mvps),
        cell('BEDS', input.beds, ICONS.bed, input.positions.beds),
        cell('STREAK', input.streak, ICONS.flame, input.positions.streak),
      ),
    ),

    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X,
        top: 495,
        fontFamily: MEDIUM,
        fontSize: 13,
        letterSpacing: 1.2,
        color: C.mute,
      },
    }, 'LAST 10 MATCHES'),

    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X,
        top: 523,
        width: CONTENT_W,
        height: 42,
        display: 'flex',
        flexDirection: 'row',
        gap: 8,
      },
    }, ...Array.from({ length: 10 }, (_, index) => matchBar(input.matches[index] ?? 'unknown'))),

    h('svg', {
      width: buttonW,
      height: 52,
      style: { position: 'absolute', left: CONTENT_X + CONTENT_W - buttonW, top: 588 },
    }, h('path', { d: `M10 0 H${buttonW} L${buttonW - 10} 52 H0 Z`, fill: C.accent })),
    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X + CONTENT_W - buttonW,
        top: 588,
        width: buttonW,
        height: 52,
        textAlign: 'center',
        fontFamily: SEMIBOLD,
        fontSize: 18,
        letterSpacing: 1.2,
        lineHeight: '52px',
        color: C.onAccent,
      },
    }, inviteLabel),
  ].filter(Boolean) as VNode[];
}

export function defaultTemplate(input: DefaultTemplateInput): { root: VNode; width: number; height: number } {
  const root = h('div', {
    style: {
      display: 'flex',
      position: 'relative',
      width: WIDTH,
      height: HEIGHT,
      overflow: 'hidden',
      backgroundColor: C.page,
    },
  },
    h('img', {
      src: staticImageDataUrl('backgrounds', 'halftone.png'),
      width: WIDTH,
      height: HEIGHT,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: WIDTH,
        height: HEIGHT,
        objectFit: 'cover',
      },
    }),
    ...card(input),
    grainLayer(WIDTH, HEIGHT),
  );

  return { root, width: WIDTH, height: HEIGHT };
}


