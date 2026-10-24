import type { TaxonomyNode } from './knowledge-taxonomy-data';

export const palette = ['#7398ff', '#8dd0ff', '#e578a8', '#e5c692', '#ef786f', '#c9a1dc', '#7bc6b4', '#efb28d', '#b8c56d', '#a8b7ea', '#69bbc2', '#d39772', '#b5a1f2', '#c1d8c4'];
/** Stable layered layout: order and parentage come only from the catalog. */
export function graphPositions(nodes: TaxonomyNode[], colors: readonly string[] = palette) {
  const byParent = new Map<string, TaxonomyNode[]>();
  nodes.forEach(node => { const key = node.parent ?? ''; const group = byParent.get(key) ?? []; group.push(node); byParent.set(key, group); });
  const positions = new Map<string, { x: number; y: number; z: number; color: string }>();
  let leaf = 0;
  const place = (node: TaxonomyNode, depth: number, color: string): number => {
    const children = byParent.get(node.id) ?? [];
    const values = children.map(child => place(child, depth + 1, color));
    const x = values.length ? (values[0] + values.at(-1)!) / 2 : leaf++;
    positions.set(node.id, { x, y: 1.5 - depth, z: Math.sin(node.order * 2.39996 + depth) * .32, color });
    return x;
  };
  (byParent.get('') ?? []).forEach((node, index) => place(node, 0, colors[index % colors.length]));
  for (const point of positions.values()) point.x = (point.x / Math.max(1, leaf - 1) - .5) * 5.5;
  return positions;
}
