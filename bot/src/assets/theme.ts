import { h, VNode } from './renderer';

export const COLORS = {
  bg: '#070a11',
  bgTop: '#0d141e',
  panel: '#0d131d',
  panelAlt: '#111a26',
  panelRaised: '#151f2d',
  line: '#1e2a38',
  lineSoft: '#17212d',
  text: '#f2f6fb',
  muted: '#7b899d',
  faint: '#536173',
  cyan: '#4de1f2',
  green: '#4ade80',
  red: '#fb7185',
  gold: '#fbbf24',
  purple: '#a78bfa',
} as const;

export const FONT = 'PoppinsRegular';
export const MEDIUM = 'PoppinsMedium';
export const LIGHT = 'PoppinsLight';

export type TextAlign = 'left' | 'center' | 'right';

export function text(
  x: number,
  y: number,
  width: number,
  height: number,
  content: string,
  size: number,
  color: string = COLORS.text,
  font: string = FONT,
  align: TextAlign = 'left',
  letterSpacing = 0,
): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
      fontFamily: font,
      fontSize: size,
      color,
      textAlign: align,
      letterSpacing,
      lineHeight: `${height}px`,
      overflow: 'hidden',
      whiteSpace: 'nowrap',
    },
  }, content);
}

export function panel(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 16,
  fill: string = COLORS.panel,
  border: string = COLORS.line,
): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
      borderRadius: radius,
      backgroundColor: fill,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: border,
    },
  });
}

export type BadgeOptions = {
  color?: string;
  background?: string;
  border?: string;
  height?: number;
  size?: number;
  font?: string;
  radius?: number;
  letterSpacing?: number;
};

export function badge(
  x: number,
  y: number,
  width: number,
  content: string,
  options: BadgeOptions = {},
): VNode {
  const {
    color = COLORS.cyan,
    background = COLORS.panelRaised,
    border = COLORS.line,
    height = 26,
    size = 12,
    font = MEDIUM,
    radius = 8,
    letterSpacing = 0.6,
  } = options;

  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
      borderRadius: radius,
      backgroundColor: background,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: border,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: font,
      fontSize: size,
      letterSpacing,
      color,
      overflow: 'hidden',
      whiteSpace: 'nowrap',
    },
  }, content);
}

export function avatar(
  src: string,
  x: number,
  y: number,
  size: number,
  radius = 10,
  border: string = COLORS.line,
): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width: size,
      height: size,
      borderRadius: radius,
      overflow: 'hidden',
      backgroundColor: COLORS.panelRaised,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: border,
    },
  },
    h('img', {
      src,
      width: size,
      height: size,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width: size,
        height: size,
      },
    }),
  );
}

export function divider(
  x: number,
  y: number,
  width: number,
  color: string = COLORS.line,
  height = 1,
): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
      backgroundColor: color,
    },
  });
}

export function accent(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string = COLORS.cyan,
  radius = 2,
): VNode {
  return h('div', {
    style: {
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
      borderRadius: radius,
      backgroundColor: color,
    },
  });
}

export function sectionLabel(
  x: number,
  y: number,
  title: string,
  color: string = COLORS.muted,
  accentColor: string = COLORS.cyan,
): VNode {
  return h('div', {},
    accent(x, y + 4, 3, 12, accentColor, 2),
    text(x + 11, y, 420, 20, title, 12, color, MEDIUM, 'left', 1.4),
  );
}

export function decor(width: number, height: number, prefix: string): VNode {
  const gridId = `${prefix}-grid`;
  const glowAId = `${prefix}-glow-a`;
  const glowBId = `${prefix}-glow-b`;
  const topLineId = `${prefix}-top-line`;

  return h('svg', {
    width,
    height,
    style: { position: 'absolute', left: 0, top: 0 },
  },
    h('defs', {},
      h('pattern', {
        id: gridId,
        width: 40,
        height: 40,
        patternUnits: 'userSpaceOnUse',
      },
        h('path', {
          d: 'M 40 0 L 0 0 0 40',
          fill: 'none',
          stroke: '#5b6b7e',
          strokeWidth: 0.5,
        }),
      ),
      h('radialGradient', { id: glowAId },
        h('stop', { offset: '0%', stopColor: COLORS.cyan, stopOpacity: '0.13' }),
        h('stop', { offset: '100%', stopColor: COLORS.cyan, stopOpacity: '0' }),
      ),
      h('radialGradient', { id: glowBId },
        h('stop', { offset: '0%', stopColor: COLORS.purple, stopOpacity: '0.10' }),
        h('stop', { offset: '100%', stopColor: COLORS.purple, stopOpacity: '0' }),
      ),
      h('linearGradient', {
        id: topLineId,
        x1: '0%',
        y1: '0%',
        x2: '100%',
        y2: '0%',
      },
        h('stop', { offset: '0%', stopColor: COLORS.cyan, stopOpacity: '0' }),
        h('stop', { offset: '22%', stopColor: COLORS.cyan, stopOpacity: '0.8' }),
        h('stop', { offset: '78%', stopColor: COLORS.cyan, stopOpacity: '0.8' }),
        h('stop', { offset: '100%', stopColor: COLORS.cyan, stopOpacity: '0' }),
      ),
    ),
    h('rect', {
      width,
      height,
      fill: `url(#${gridId})`,
      opacity: 0.13,
    }),
    h('ellipse', {
      cx: width * 0.16,
      cy: 40,
      rx: width * 0.32,
      ry: height * 0.3,
      fill: `url(#${glowAId})`,
    }),
    h('ellipse', {
      cx: width * 0.88,
      cy: height * 0.94,
      rx: width * 0.28,
      ry: height * 0.35,
      fill: `url(#${glowBId})`,
    }),
    h('rect', {
      x: 0,
      y: 0,
      width,
      height: 2,
      fill: `url(#${topLineId})`,
    }),
  );
}

export function gameFooter(
  width: number,
  serverName: string,
  inviteLink: string,
  y = 966,
): VNode {
  return h('div', {},
    divider(60, y, width - 120, COLORS.line, 1),

    serverName
      ? text(60, y + 16, 600, 24, serverName, 17, COLORS.faint, MEDIUM, 'left', 0.6)
      : null,

    text(
      width / 2 - 300, y + 18, 600, 22,
      'RANKED BEDWARS',
      12, '#3f4b5a', MEDIUM, 'center', 2.4,
    ),

    inviteLink
      ? text(width - 660, y + 16, 600, 24, inviteLink, 17, COLORS.faint, FONT, 'right')
      : null,
  );
}

export function rootStyle(width: number, height: number): Record<string, unknown> {
  return {
    display: 'flex',
    position: 'relative',
    width,
    height,
    overflow: 'hidden',
    backgroundColor: COLORS.bg,
    backgroundImage: 'linear-gradient(145deg, #0c121a 0%, #080b11 60%, #06080d 100%)',
  };
}
