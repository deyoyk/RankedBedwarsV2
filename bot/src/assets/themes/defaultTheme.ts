import { h, VNode } from '../renderer';
import { MEDIUM, SEMIBOLD } from '../theme';
import { staticImageDataUrl } from '../assets';

export const AX = {
  pageTop: '#EADCF8',
  pageBottom: '#D1B9E9',
  ink: '#1B1327',
  mute: '#56486A',
  paper: '#FBF8FF',
  paperDim: '#F3EAFB',
  panel: '#EDE2F6',
  accent: '#7C3AED',
  accentDeep: '#4C1D95',
  accentSoft: '#A78BFA',
  line: 'rgba(27, 19, 39, 0.25)',
  lineSoft: 'rgba(27, 19, 39, 0.12)',
  grid: 'rgba(27, 19, 39, 0.065)',
  gridStrong: 'rgba(27, 19, 39, 0.11)',
  pageGrid: 'rgba(248, 243, 255, 0.055)',
  pageGridStrong: 'rgba(248, 243, 255, 0.09)',
  chromeLine: 'rgba(248, 243, 255, 0.14)',
  chromeText: '#BDA9D8',
  block: '#150A24',
  blockText: '#F8F3FF',
  blockMute: '#BDA9D8',
  blockLine: 'rgba(248, 243, 255, 0.18)',
  white: '#FFFFFF',
  win: '#2C854D',
  loss: '#C0392B',
  voided: '#D9DBE2',
  active: '#E0B400',
  unknown: '#BCBEC8',
} as const;

export function axGrid(width: number, height: number, step = 40): VNode[] {
  const nodes: VNode[] = [];
  for (let x = step; x < width; x += step) {
    nodes.push(h('div', {
      style: {
        position: 'absolute',
        left: x,
        top: 0,
        width: 1,
        height,
        backgroundColor: x % (step * 5) === 0 ? AX.pageGridStrong : AX.pageGrid,
      },
    }));
  }
  for (let y = step; y < height; y += step) {
    nodes.push(h('div', {
      style: {
        position: 'absolute',
        left: 0,
        top: y,
        width,
        height: 1,
        backgroundColor: y % (step * 5) === 0 ? AX.pageGridStrong : AX.pageGrid,
      },
    }));
  }
  return nodes;
}

export function axPanelGrid(x: number, y: number, width: number, height: number, step: number, color = AX.grid): VNode[] {
  const nodes: VNode[] = [];
  for (let px = step; px < width; px += step) {
    nodes.push(h('div', {
      style: { position: 'absolute', left: x + px, top: y, width: 1, height, backgroundColor: color },
    }));
  }
  for (let py = step; py < height; py += step) {
    nodes.push(h('div', {
      style: { position: 'absolute', left: x, top: y + py, width, height: 1, backgroundColor: color },
    }));
  }
  return nodes;
}

function plus(x: number, y: number, color: string): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width: 18,
      height: 18,
      fontFamily: MEDIUM,
      fontSize: 17,
      lineHeight: '18px',
      color,
    },
  }, '+');
}

function tick(x: number, y: number, color: string): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width: 13,
      height: 4,
      backgroundColor: color,
      transform: 'skewY(-30deg)',
    },
  });
}

function coordinate(x: number, y: number, label: string, align: 'left' | 'right'): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width: 110,
      textAlign: align,
      fontFamily: MEDIUM,
      fontSize: 9,
      letterSpacing: 2.2,
      lineHeight: '12px',
      color: AX.chromeText,
    },
  }, label);
}

export function axChrome(width: number, height: number): VNode[] {
  return [
    h('div', { style: { position: 'absolute', left: 16, top: 0, width: 1, height, backgroundColor: AX.chromeLine } }),
    h('div', { style: { position: 'absolute', left: width - 17, top: 0, width: 1, height, backgroundColor: AX.chromeLine } }),
    plus(7, 12, AX.chromeText),
    plus(width - 25, 12, AX.chromeText),
    plus(7, height - 28, AX.chromeText),
    plus(width - 25, height - 28, AX.chromeText),
    coordinate(27, 168, 'Y 128', 'left'),
    coordinate(27, height - 172, 'Y 064', 'left'),
    coordinate(width - 137, 148, '01', 'right'),
    coordinate(width - 137, height - 188, '02', 'right'),
    tick(width - 30, height - 116, AX.chromeText),
    tick(width - 30, height - 104, AX.chromeText),
    tick(width - 30, height - 92, AX.chromeText),
  ];
}

export function axPage(width: number, height: number): VNode[] {
  return [
    h('img', {
      src: staticImageDataUrl('backgrounds', 'halftone.png'),
      width,
      height,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        objectFit: 'cover',
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        backgroundColor: 'rgba(10, 5, 18, 0.6)',
      },
    }),
    ...axGrid(width, height),
    ...axChrome(width, height),
  ];
}

function line(x: number, y: number, width: number, height: number, color: string): VNode {
  return h('div', { style: { position: 'absolute', left: x, top: y, width, height, backgroundColor: color } });
}

export function axBrackets(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string = AX.mute,
  size = 16,
  weight = 2,
): VNode[] {
  return [
    line(x, y, size, weight, color),
    line(x, y, weight, size, color),
    line(x + width - size, y, size, weight, color),
    line(x + width - weight, y, weight, size, color),
    line(x, y + height - weight, size, weight, color),
    line(x, y + height - size, weight, size, color),
    line(x + width - size, y + height - weight, size, weight, color),
    line(x + width - weight, y + height - size, weight, size, color),
  ];
}

export function axStamp(x: number, y: number, label: string, size = 56): VNode[] {
  return [
    h('div', {
      style: {
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        backgroundColor: AX.accent,
        transform: 'rotate(-5deg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    }),
    h('div', {
      style: {
        position: 'absolute',
        left: x + 4,
        top: y + 4,
        width: size - 8,
        height: size - 8,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'rgba(255, 255, 255, 0.85)',
        transform: 'rotate(-5deg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
      h('div', {
        style: {
          fontFamily: SEMIBOLD,
          fontSize: Math.round(size * 0.24),
          letterSpacing: 1,
          lineHeight: `${Math.round(size * 0.3)}px`,
          color: AX.white,
        },
      }, label),
    ),
  ];
}
