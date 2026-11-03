import { renderImage, type RenderOptions } from './imageRenderQueue';

export type VNode = {
  type: string;
  props: Record<string, unknown>;
};

export function h(type: string, props: Record<string, unknown> = {}, ...children: unknown[]): VNode {
  const flat = children.flat(Infinity) as unknown[];
  const kept = flat.filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: kept.length === 1 ? kept[0] : kept } };
}

export function renderPng(
  root: VNode,
  width: number,
  height: number,
  options?: RenderOptions,
): Promise<Buffer> {
  return renderImage(root, width, height, options);
}
