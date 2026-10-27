import type { TaxonomyNode } from './knowledge-taxonomy-data';

export interface TerrainPoint { id: string; x: number; y: number; count: number; brand: string; level: TaxonomyNode['level']; label: string }
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
/** Deterministic hierarchical placement: the same catalog gives the same coordinates. */
export function terrainLayout(nodes: readonly TaxonomyNode[]): TerrainPoint[] {
  const children = new Map<string, TaxonomyNode[]>();
  for (const node of nodes) { const key = node.parent ?? ''; const group = children.get(key) ?? []; group.push(node); children.set(key, group); }
  const points: TerrainPoint[] = [], brands = children.get('') ?? [];
  const descend = (node: TaxonomyNode, x: number, y: number, radius: number, brand: string) => {
    points.push({ id: node.id, x, y, count: node.count, brand, level: node.level, label: node.label });
    const group = children.get(node.id) ?? [];
    group.forEach((child, i) => {
      const distance = radius * Math.sqrt((i + .5) / Math.max(group.length, 1));
      const angle = i * goldenAngle;
      descend(child, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, radius * .34, brand);
    });
  };
  brands.forEach((node, i) => {
    const radius = .37 * Math.sqrt((i + .5) / Math.max(brands.length, 1));
    descend(node, .5 + radius * Math.cos(i * goldenAngle), .5 + radius * Math.sin(i * goldenAngle), .105, node.id);
  });
  return points;
}
