import { h, VNode } from './renderer';

export const COLORS = {
  bg: '#0B0D12',
  surface: '#11151C',
  line: '#232A35',
  lineSoft: '#171C24',
  text: '#F4F7FB',
  muted: '#9AA4B5',
  faint: '#5F6B7C',
  cyan: '#54E4F2',
  green: '#5DE2A2',
  red: '#FF647C',
  gold: '#FFC857',
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

export function avatar(
  src: string,
  x: number,
  y: number,
  size: number,
  radius = 8,
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
      backgroundColor: COLORS.surface,
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

export function gameFooter(
  width: number,
  serverName: string,
  inviteLink: string,
  y = 1008,
): VNode {
  return h('div', {},
    divider(72, y, width - 144, COLORS.line, 1),

    serverName
      ? text(72, y + 16, 760, 24, serverName, 18, COLORS.muted, MEDIUM, 'left', 0.4)
      : null,

    inviteLink
      ? text(width - 832, y + 16, 760, 24, inviteLink, 18, COLORS.faint, FONT, 'right')
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
  };
}
