import type { TaxonomyNode } from './knowledge-taxonomy-data';

/** Counts are catalog associations, never the sum of every taxonomy level. */
export function indexEngineCatalog(nodes: TaxonomyNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map<string, TaxonomyNode[]>();
  for (const node of nodes) {
    const key = node.parent ?? '';
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(node);
  }
  const brands = nodes.filter(node => node.level === 'brand');
  const maximum = Math.max(1, ...brands.map(node => node.count));
  return {
    byId, children, brands,
    entries: brands.reduce((sum, node) => sum + node.count, 0),
    models: nodes.filter(node => node.level === 'model').length,
    distribution: brands.map(node => ({ node, percent: node.count / maximum * 100 })),
  };
}
export function selectEngineCatalog(index: ReturnType<typeof indexEngineCatalog>, selectedId: string) {
  const selected = index.byId.get(selectedId);
  const path: TaxonomyNode[] = [], visited = new Set<string>();
  let current = selected;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parent ? index.byId.get(current.parent) : undefined;
  }
  const children = index.children.get(selected?.id ?? '') ?? [];
  return { selected, path, children, coverage: children.length ? children : selected ? [selected] : [] };
}
