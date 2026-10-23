import type { KnowledgeCatalog } from '@shared/knowledge-catalog';

export interface SphereNode {
  id: string;
  label: string;
  kind: 'root' | 'brand' | 'model' | 'component' | 'part';
  count: number;
  parent?: string;
  scope?: string;
  query: Record<string, string>;
  position: [number, number, number];
}

/** Edges represent catalog membership only, never inferred fault causality. */
export function sphereNodes(catalog: KnowledgeCatalog): SphereNode[] {
  const nodes: Omit<SphereNode, 'position'>[] = [];
  for (const brand of catalog.brands) {
    nodes.push({
      id: `brand:${brand.id}`,
      label: brand.name,
      kind: 'brand',
      count: brand.entryCount,
      query: { brand: brand.id },
    });
    for (const model of brand.models) {
      const id = `model:${brand.id}:${model.id}`;
      nodes.push({
        id,
        parent: `brand:${brand.id}`,
        label: model.name,
        kind: 'model',
        count: model.entryCount,
        scope: model.scope,
        query: { brand: brand.id, model: model.id },
      });
      for (const component of model.components) {
        const componentId = `${id}:${component.id}`;
        nodes.push({
          id: componentId,
          parent: id,
          label: component.name,
          kind: 'component',
          scope: model.scope,
          count: component.entryCount,
          query: { brand: brand.id, model: model.id, component: component.id },
        });
        for (const part of component.parts) {
          nodes.push({
            id: `${componentId}:${part.id}`,
            parent: componentId,
            label: part.name,
            kind: 'part',
            scope: model.scope,
            count: part.entryCount,
            query: { brand: brand.id, model: model.id, component: component.id, part: part.id },
          });
        }
      }
    }
  }
  return nodes.map((node, index) => {
    const y = 1 - (2 * (index + 0.5)) / nodes.length;
    const radius = Math.sqrt(1 - y * y);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return { ...node, position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius] };
  });
}

/** A scale contains only its immediate children; unrelated brands never mix. */
export function sphereLevel(allNodes: SphereNode[], region: SphereNode, expanded: boolean): SphereNode[] {
  const centre = { ...region, position: [0, 0, 0] as [number, number, number] };
  if (!expanded) return [centre];
  const children = allNodes.filter((node) =>
    region.kind === 'root' ? node.kind === 'brand' : node.parent === region.id,
  );
  return [
    centre,
    ...children.map((node, index) => {
      const y = 1 - (2 * (index + 0.5)) / children.length;
      const radius = Math.sqrt(1 - y * y),
        angle = index * Math.PI * (3 - Math.sqrt(5));
      return { ...node, position: [Math.cos(angle) * radius, y, Math.sin(angle) * radius] as [number, number, number] };
    }),
  ];
}
