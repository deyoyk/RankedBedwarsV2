import { h, VNode } from '../renderer';
import { MEDIUM, SEMIBOLD, text } from '../theme';
import { grainLayer } from '../grain';
import { DivisionTag, divisionTagBadge } from '../divisionTag';
import { AX, axBrackets, axPanelGrid, axPage } from '../themes/defaultTheme';

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
const CARD_X = 44;
const CARD_Y = 44;
const CARD_W = WIDTH - CARD_X * 2;
const CARD_H = HEIGHT - CARD_Y * 2;
const GUTTER = 24;
const SKIN_W = 236;
const SKIN_H = 330;
const CONTENT_X = CARD_X + GUTTER + SKIN_W + 24;
const CONTENT_W = CARD_W - GUTTER * 2 - SKIN_W - 24;

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
      justifyContent: 'space-between',
      paddingTop: 13,
      paddingBottom: 13,
      paddingLeft: 16,
      paddingRight: 16,
      backgroundColor: AX.paper,
    },
  },
    h('div', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        fontFamily: MEDIUM,
        fontSize: 11,
        letterSpacing: 1.1,
        lineHeight: '14px',
        color: AX.mute,
      },
    },
      icon(iconPath, 14, AX.mute),
      label,
      h('div', {
        style: {
          marginLeft: 'auto',
          fontFamily: MEDIUM,
          fontSize: 10,
          letterSpacing: 0.6,
          lineHeight: '12px',
          color: AX.accentDeep,
        },
      }, position),
    ),
    h('div', {
      style: {
        fontFamily: SEMIBOLD,
        fontSize: 30,
        lineHeight: '34px',
        color: AX.ink,
        whiteSpace: 'nowrap',
      },
    }, value),
  );
}

function matchBar(result: MatchResult): VNode {
  const backgroundColor = result === 'win'
    ? AX.win
    : result === 'loss'
      ? AX.loss
      : result === 'voided'
        ? AX.voided
        : result === 'active'
          ? AX.active
          : AX.unknown;
  return h('div', {
    style: {
      flex: 1,
      height: 38,
      backgroundColor,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: AX.lineSoft,
      transform: 'skewX(-20deg)',
    },
  });
}

function legendDot(color: string): VNode {
  return h('div', { style: { width: 7, height: 7, backgroundColor: color, transform: 'rotate(45deg)' } });
}

function legendEntry(color: string, label: string): VNode {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      fontFamily: MEDIUM,
      fontSize: 9,
      letterSpacing: 1.2,
      lineHeight: '12px',
      color: AX.mute,
    },
  }, legendDot(color), label);
}

function skinPlate(input: DefaultTemplateInput): VNode[] {
  const x = CARD_X + GUTTER;
  const y = CARD_Y + 154;
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: x,
        top: y,
        width: SKIN_W,
        height: SKIN_H,
        backgroundColor: AX.panel,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: AX.lineSoft,
      },
    }),
    ...axPanelGrid(x, y, SKIN_W, SKIN_H, 26),
    input.skin
      ? h('img', {
        src: input.skin,
        width: 190,
        height: 272,
        style: {
          position: 'absolute',
          left: x + 23,
          top: y + 28,
          width: 190,
          height: 272,
          objectFit: 'contain',
          filter: 'grayscale(1) contrast(1.08)',
        },
      })
      : h('div', {
        style: {
          position: 'absolute',
          left: x + 66,
          top: y + 72,
          width: 104,
          height: 170,
          backgroundColor: '#D8CBE8',
        },
      }),
    ...axBrackets(x + 9, y + 9, SKIN_W - 18, SKIN_H - 18, AX.mute, 13, 2),
  ];
}

function statGrid(input: DefaultTemplateInput): VNode[] {
  const x = CONTENT_X;
  const y = CARD_Y + 154;
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: x,
        top: y,
        width: CONTENT_W,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        backgroundColor: AX.lineSoft,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: AX.lineSoft,
        borderTopWidth: 4,
        borderTopColor: AX.accent,
      },
    },
      h('div', { style: { display: 'flex', flexDirection: 'row', gap: 1, height: 112 } },
        cell('WINS', input.wins, ICONS.trophy, input.positions.wins),
        cell('LOSSES', input.losses, ICONS.skull, input.positions.losses),
        cell('W/L', input.wlr, ICONS.sword, input.positions.wlr),
      ),
      h('div', { style: { display: 'flex', flexDirection: 'row', gap: 1, height: 112 } },
        cell('MVPS', input.mvps, ICONS.crown, input.positions.mvps),
        cell('BEDS', input.beds, ICONS.bed, input.positions.beds),
        cell('STREAK', input.streak, ICONS.flame, input.positions.streak),
      ),
    ),
  ];
}

function matches(input: DefaultTemplateInput): VNode[] {
  const x = CONTENT_X;
  const y = CARD_Y + 420;
  return [
    text(x, y, 400, 16, 'LAST 10 MATCHES', 11, AX.mute, SEMIBOLD, 'left', 1.6),
    h('div', {
      style: {
        position: 'absolute',
        left: x + CONTENT_W - 250,
        top: y,
        width: 250,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 14,
      },
    },
      legendEntry(AX.win, 'WIN'),
      legendEntry(AX.loss, 'LOSS'),
      legendEntry(AX.active, 'LIVE'),
    ),
    h('div', {
      style: {
        position: 'absolute',
        left: x,
        top: y + 24,
        width: CONTENT_W,
        height: 38,
        display: 'flex',
        flexDirection: 'row',
        gap: 7,
      },
    }, ...Array.from({ length: 10 }, (_, index) => matchBar(input.matches[index] ?? 'unknown'))),
  ];
}

function card(input: DefaultTemplateInput): VNode[] {
  const nameSize = input.ign.length > 12 ? 44 : 52;
  const inviteLabel = input.inviteLink.includes('.gg/')
    ? input.inviteLink.slice(input.inviteLink.lastIndexOf('.gg/'))
    : input.inviteLink;
  const buttonW = 236;
  const buttonX = CONTENT_X + CONTENT_W - buttonW;

  return [
    h('div', {
      style: {
        position: 'absolute',
        left: CARD_X + 10,
        top: CARD_Y + 10,
        width: CARD_W,
        height: CARD_H,
        backgroundColor: 'rgba(236, 72, 153, 0.3)',
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: CARD_X,
        top: CARD_Y,
        width: CARD_W,
        height: CARD_H,
        backgroundColor: AX.paper,
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: AX.ink,
      },
    }),
    text(CARD_X + 470, CARD_Y + 14, 590, 120, 'ELO', 112, 'rgba(236, 72, 153, 0.06)', SEMIBOLD, 'right', -2),
    text(CARD_X + GUTTER, CARD_Y + 18, 300, 16, 'PLAYER STATS', 11, AX.mute, SEMIBOLD, 'left', 2.2),
    text(CARD_X + CARD_W - 246, CARD_Y + 18, 216, 16, 'ELO', 12, AX.mute, SEMIBOLD, 'right', 2.2),
    text(CARD_X + CARD_W - 276, CARD_Y + 34, 246, 64, String(input.elo), 62, AX.ink, SEMIBOLD, 'right', -1.6),
    text(CARD_X + CARD_W - 216, CARD_Y + 100, 186, 16, input.positions.elo, 12, AX.accent, SEMIBOLD, 'right', 0.8),
    h('div', {
      style: {
        position: 'absolute',
        left: CARD_X + GUTTER,
        top: CARD_Y + 132,
        width: CARD_W - GUTTER * 2,
        height: 2,
        backgroundColor: AX.ink,
      },
    }),
    ...skinPlate(input),
    ...statGrid(input),
    ...matches(input),
    h('svg', {
      width: CONTENT_W,
      height: 36,
      style: { position: 'absolute', left: CONTENT_X, top: CARD_Y + CARD_H - 60 },
    }, h('path', { d: `M0 0 H${CONTENT_W} L${CONTENT_W - 8.5} 36 H0 Z`, fill: AX.block })),
    h('div', {
      style: {
        position: 'absolute',
        left: CONTENT_X,
        top: CARD_Y + CARD_H - 60,
        width: CONTENT_W,
        height: 36,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
      },
    },
      h('div', { style: { width: 4, height: 36, backgroundColor: AX.accent } }),
      h('div', {
        style: {
          marginLeft: 14,
          fontFamily: SEMIBOLD,
          fontSize: 10,
          letterSpacing: 2,
          lineHeight: '12px',
          color: AX.blockText,
        },
      }, 'VRBW.CLUB  /  RANKED BEDWARS'),
      h('div', {
        style: {
          marginLeft: 'auto',
          marginRight: 14,
          fontFamily: MEDIUM,
          fontSize: 10,
          letterSpacing: 1.6,
          lineHeight: '12px',
          color: AX.blockMute,
        },
      }, 'SEASON 01  ·  UPDATED LIVE'),
    ),
    h('div', {
      style: {
        position: 'absolute',
        left: CARD_X + 24,
        top: CARD_Y + 34,
        width: 620,
        height: 62,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      },
    },
      h('div', {
        style: {
          fontFamily: SEMIBOLD,
          fontSize: nameSize,
          letterSpacing: -1.6,
          lineHeight: `${nameSize + 6}px`,
          color: AX.ink,
          whiteSpace: 'nowrap',
        },
      }, input.ign),
      divisionTagBadge(input.divisionTag, 15),
    ),
    h('div', {
      style: {
        position: 'absolute',
        left: CARD_X + 26,
        top: CARD_Y + 98,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      },
    },
      h('div', {
        style: {
          width: 9,
          height: 9,
          backgroundColor: input.rankColor,
          transform: 'rotate(45deg)',
        },
      }),
      h('div', {
        style: {
          fontFamily: MEDIUM,
          fontSize: 14,
          letterSpacing: 2,
          lineHeight: '18px',
          color: AX.mute,
        },
      }, `[  ${input.rankName.toUpperCase()}  ]`),
    ),
    ...axBrackets(CARD_X + 10, CARD_Y + 10, CARD_W - 20, CARD_H - 20, AX.lineSoft, 14, 2),
    h('svg', {
      width: buttonW,
      height: 34,
      style: { position: 'absolute', left: buttonX, top: CARD_Y + CARD_H - 59 },
    }, h('path', { d: `M8 0 H${buttonW} L${buttonW - 8} 34 H0 Z`, fill: AX.accent })),
    text(buttonX + 8, CARD_Y + CARD_H - 59, buttonW - 16, 34, inviteLabel, 12, AX.white, SEMIBOLD, 'center', 1.2),
    h('div', {
      style: {
        position: 'absolute',
        left: CARD_X + 24,
        top: CARD_Y + CARD_H - 48,
        fontFamily: MEDIUM,
        fontSize: 11,
        letterSpacing: 2,
        lineHeight: '14px',
        color: AX.mute,
      },
    }, 'PLAYER CARD'),
  ];
}

export function defaultTemplate(input: DefaultTemplateInput): { root: VNode; height: number; width: number } {
  const root = h('div', {
    style: {
      display: 'flex',
      position: 'relative',
      width: WIDTH,
      height: HEIGHT,
      overflow: 'hidden',
      backgroundColor: AX.pageBottom,
    },
  },
    ...axPage(WIDTH, HEIGHT),
    ...card(input),
    grainLayer(WIDTH, HEIGHT, 0.16),
  );

  return { root, width: WIDTH, height: HEIGHT };
}
