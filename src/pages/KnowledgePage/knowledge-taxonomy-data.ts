import type { KnowledgeCatalog, KnowledgeRole, RoleCoverage } from '../../../shared/knowledge-catalog';

export interface TaxonomyNode {
  id: string;
  label: string;
  level: 'brand' | 'model' | 'component' | 'part';
  parent?: string;
  order: number;
  count: number;
  entryTypes?: string[];
  roleCoverage?: RoleCoverage;
  scope?: 'exact' | 'series' | 'pending';
  query: Record<string, string>;
}
/** Preserve catalog order and reviewed membership. No prerequisites or causality inferred. */
export function taxonomyNodes(catalog: KnowledgeCatalog): TaxonomyNode[] {
  const nodes: TaxonomyNode[] = [];
  const key = (values: string[]) => JSON.stringify(values);
  catalog.brands.forEach((brand, order) => {
    const brandId = key([brand.id]);
    nodes.push({ id: brandId, label: brand.name, level: 'brand', order, count: brand.entryCount, entryTypes: brand.entryTypes, roleCoverage: brand.roleCoverage, query: { brand: brand.id } });
    brand.models.forEach((model, order) => {
      const modelId = key([brand.id, model.id]);
      nodes.push({ id: modelId, parent: brandId, label: model.name, level: 'model', order, count: model.entryCount, entryTypes: model.entryTypes, roleCoverage: model.roleCoverage, scope: model.scope, query: { brand: brand.id, model: model.id } });
      model.components.forEach((component, order) => {
        const componentId = key([brand.id, model.id, component.id]);
        nodes.push({ id: componentId, parent: modelId, label: component.name, level: 'component', order, count: component.entryCount, entryTypes: component.entryTypes, roleCoverage: component.roleCoverage, scope: model.scope, query: { brand: brand.id, model: model.id, component: component.id } });
        component.parts.forEach((part, order) => nodes.push({ id: key([brand.id, model.id, component.id, part.id]), parent: componentId, label: part.name, level: 'part', order, count: part.entryCount, entryTypes: part.entryTypes, roleCoverage: part.roleCoverage, scope: model.scope, query: { brand: brand.id, model: model.id, component: component.id, part: part.id } }));
      });
    });
  });
  return nodes;
}

export interface TaxonomyFilters {
  entryType?: string;
  role?: KnowledgeRole;
}

/** Keep matching nodes addressable by retaining their reviewed parent path. */
export function visibleTaxonomyNodes(nodes: TaxonomyNode[], filters: TaxonomyFilters): TaxonomyNode[] {
  if (!filters.entryType && !filters.role) return nodes;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const visible = new Set<string>();
  nodes.forEach(node => {
    const typeMatch = !filters.entryType || node.entryTypes?.includes(filters.entryType);
    const roleMatch = !filters.role || (node.roleCoverage?.[filters.role] ?? 0) > 0;
    if (!typeMatch || !roleMatch) return;
    let current: TaxonomyNode | undefined = node;
    while (current) { visible.add(current.id); current = current.parent ? byId.get(current.parent) : undefined; }
  });
  return nodes.filter(node => visible.has(node.id));
}
