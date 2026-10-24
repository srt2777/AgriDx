import type { TaxonomyNode } from './knowledge-taxonomy-data';

export const palette = ['#7398ff', '#8dd0ff', '#e578a8', '#e5c692', '#ef786f', '#c9a1dc', '#7bc6b4', '#efb28d', '#b8c56d', '#a8b7ea', '#69bbc2', '#d39772', '#b5a1f2', '#c1d8c4'];
/** Display-only spherical projection; identity, order, parents and queries stay untouched. */
export function graphPositions(nodes: TaxonomyNode[], colors: readonly string[] = palette) {
  const positions = new Map<string, { x: number; y: number; z: number; color: string }>();
  const byId = new Map(nodes.map(node => [node.id, node]));
  const brands = nodes.filter(node => node.level === 'brand');
  const brandColors = new Map(brands.map((node, index) => [node.id, colors[index % colors.length] ?? palette[0]]));
  nodes.forEach((node, index) => {
    let ancestor = node;
    while (ancestor.parent && byId.has(ancestor.parent)) ancestor = byId.get(ancestor.parent)!;
    const y = 1 - 2 * (index + .5) / nodes.length;
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    positions.set(node.id, {
      x: 2 * radial * Math.cos(angle), y: 2 * y, z: 2 * radial * Math.sin(angle),
      color: brandColors.get(ancestor.id) ?? palette[0],
    });
  });
  return positions;
}
