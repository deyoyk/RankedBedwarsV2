import { h, VNode } from './renderer';
import { SEMIBOLD } from './theme';

export type DivisionTag = 'premium' | 'pugs' | 'pups' | 'pit';

type DivisionTagStyle = {
  label: string;
  color: string;
  background: string;
  border: string;
};

export const DIVISION_TAG_STYLES: Record<DivisionTag, DivisionTagStyle> = {
  premium: { label: 'PREMIUM', color: '#8A5A00', background: '#FFF6DA', border: '#E7C96B' },
  pugs: { label: 'PUGS', color: '#9D174D', background: '#FCE7F3', border: '#F9A8D4' },
  pups: { label: 'PUPS', color: '#075985', background: '#E0F2FE', border: '#7DD3FC' },
  pit: { label: 'PIT', color: '#475569', background: '#F1F5F9', border: '#CBD5E1' },
};

export function divisionTagBadge(tag: DivisionTag | null | undefined, fontSize = 16): VNode | null {
  if (!tag) return null;
  const style = DIVISION_TAG_STYLES[tag];
  const paddingX = Math.round(fontSize * 0.6);
  const paddingY = Math.max(2, Math.round(fontSize * 0.25));

  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: paddingX,
      paddingRight: paddingX,
      paddingTop: paddingY,
      paddingBottom: paddingY,
      borderRadius: Math.round(fontSize * 0.38),
      backgroundColor: style.background,
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: style.border,
    },
  }, h('div', {
    style: {
      fontFamily: SEMIBOLD,
      fontSize,
      letterSpacing: 1.1,
      lineHeight: `${fontSize + 4}px`,
      color: style.color,
    },
  }, style.label));
}
