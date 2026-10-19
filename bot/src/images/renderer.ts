import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadImageFonts } from './assets';

const renderSvg = (satori as any).default || (satori as any);

export type VNode = {
  type: string;
  props: Record<string, any>;
};

export function h(type: string, props: Record<string, any> = {}, ...children: any[]): VNode {
  const flat = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat } };
}

export async function renderPng(root: VNode, width: number, height: number): Promise<Buffer> {
  const svg = await renderSvg(root, { width, height, fonts: loadImageFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
}
