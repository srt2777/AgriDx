import type { KnowledgeCatalog } from '@shared/knowledge-catalog';

export interface TaxonomyNode {
  id: string;
  label: string;
  level: 'brand' | 'model' | 'component' | 'part';
  parent?: string;
  order: number;
  count: number;
  scope?: 'exact' | 'series' | 'pending';
  query: Record<string, string>;
}
/** Preserve catalog order and reviewed membership. No prerequisites or causality inferred. */
export function taxonomyNodes(catalog: KnowledgeCatalog): TaxonomyNode[] {
  const nodes: TaxonomyNode[] = [];
  const key = (values: string[]) => JSON.stringify(values);
  catalog.brands.forEach((brand, order) => {
    const brandId = key([brand.id]);
    nodes.push({ id: brandId, label: brand.name, level: 'brand', order, count: brand.entryCount, query: { brand: brand.id } });
    brand.models.forEach((model, order) => {
      const modelId = key([brand.id, model.id]);
      nodes.push({ id: modelId, parent: brandId, label: model.name, level: 'model', order, count: model.entryCount, scope: model.scope, query: { brand: brand.id, model: model.id } });
      model.components.forEach((component, order) => {
        const componentId = key([brand.id, model.id, component.id]);
        nodes.push({ id: componentId, parent: modelId, label: component.name, level: 'component', order, count: component.entryCount, scope: model.scope, query: { brand: brand.id, model: model.id, component: component.id } });
        component.parts.forEach((part, order) => nodes.push({ id: key([brand.id, model.id, component.id, part.id]), parent: componentId, label: part.name, level: 'part', order, count: part.entryCount, scope: model.scope, query: { brand: brand.id, model: model.id, component: component.id, part: part.id } }));
      });
    });
  });
  return nodes;
}
