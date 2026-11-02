import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadImageFonts, type ImageFont } from './assets';

export type VNode = {
  type: string;
  props: Record<string, unknown>;
};

type SatoriRenderFn = (
  element: VNode,
  options: { width: number; height: number; fonts: ImageFont[] },
) => Promise<string>;

const importedModule = satori as unknown as SatoriRenderFn | { default: SatoriRenderFn };
const renderSvg: SatoriRenderFn =
  typeof importedModule === 'function' ? importedModule : importedModule.default;

export function h(type: string, props: Record<string, unknown> = {}, ...children: unknown[]): VNode {
  const flat = children.flat(Infinity) as unknown[];
  const kept = flat.filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: kept.length === 1 ? kept[0] : kept } };
}

export async function renderPng(root: VNode, width: number, height: number): Promise<Buffer> {
  const svg = await renderSvg(root, { width, height, fonts: loadImageFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng());
}
