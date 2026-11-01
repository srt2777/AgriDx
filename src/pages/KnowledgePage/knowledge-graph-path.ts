import type { TaxonomyNode } from './knowledge-taxonomy-data';

/** Shortest path in the catalog forest; membership is not a causal relation. */
export function membershipPath(nodes: readonly TaxonomyNode[], from: string, to: string): TaxonomyNode[] | null {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const chain = (id: string): TaxonomyNode[] | null => {
    const path: TaxonomyNode[] = [], seen = new Set<string>();
    let current = byId.get(id);
    if (!current) return null;
    while (current) {
      if (seen.has(current.id)) return null;
      seen.add(current.id); path.push(current);
      if (!current.parent) break;
      const parent = byId.get(current.parent);
      if (!parent) return null;
      current = parent;
    }
    return path;
  };
  const left = chain(from), right = chain(to);
  if (!left || !right) return null;
  const leftIds = new Map(left.map((node, index) => [node.id, index]));
  const rightIndex = right.findIndex(node => leftIds.has(node.id));
  if (rightIndex < 0) return null;
  return [...left.slice(0, leftIds.get(right[rightIndex].id)! + 1), ...right.slice(0, rightIndex).reverse()];
}
