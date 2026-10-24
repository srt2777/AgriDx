import type { CatalogModel, KnowledgeCatalog } from '../../../shared/knowledge-catalog';
import type { PartsModelId } from './parts-catalog';

type Target = { component: string; part?: string };
/** Lookup paths only. A component-level path is never a claim of part-specific evidence. */
const DIESEL: Readonly<Record<string, Target>> = {
  engine: { component: 'engine' }, exhaust: { component: 'engine' },
  radiator: { component: 'cooling', part: 'radiator' }, battery: { component: 'electrical', part: 'battery' },
  front_axle: { component: 'chassis', part: 'front-axle' }, rear_axle: { component: 'transmission' },
  gearbox: { component: 'transmission' }, clutch: { component: 'transmission' },
  hydraulic_lift: { component: 'hydraulics' }, three_point_hitch: { component: 'hydraulics' },
  fuel_tank: { component: 'fuel' }, steering_wheel: { component: 'steering' },
  cab: { component: 'cab' }, pto: { component: 'pto', part: 'pto-shaft' },
};
const T70: Readonly<Record<string, Target>> = { gps_antenna: { component: 'navigation', part: 'gnss-antenna' } };

export type PartKnowledgeLookup = { kind: 'choose' } | {
  kind: 'pending' | 'query'; href: string; query: string; brand: string; model: string;
  scope: CatalogModel['scope']; level: 'part' | 'component'; component?: string; part?: string;
};

export function partKnowledgeLookup(catalog: KnowledgeCatalog, studio: PartsModelId, partId: string, brandId: string, modelId: string): PartKnowledgeLookup {
  // T70 has its own archive scope. Never borrow diesel battery or navigation-system manuals for it.
  const brand = catalog.brands.find(item => item.id === (studio === 't70' ? '鸿鹄' : brandId));
  const model = brand?.models.find(item => item.id === (studio === 't70' ? 'T70' : modelId) && item.machineType === '拖拉机');
  if (!brand || !model) return { kind: 'choose' };
  const params = new URLSearchParams({ brand: brand.id, model: model.id });
  const target = (studio === 'diesel' ? DIESEL : T70)[partId] ??
    (/^wheel_(fl|fr|rl|rr)$/.test(partId) ? { component: 'chassis', part: 'tyre' } :
      studio === 't70' && /^hub_(fl|fr|rl|rr)$/.test(partId) ? { component: 'chassis', part: 'wheel-bearing' } : undefined);
  const component = model.components.find(item => item.id === target?.component);
  const part = component?.parts.find(item => item.id === target?.part);
  // Missing part links stay pending; do not substitute the component count or manufacture a 404 URL.
  if (component) params.set('component', component.id);
  if (part) params.set('part', part.id);
  const query = params.toString();
  return { kind: target && component && (!target.part || part) ? 'query' : 'pending',
    href: `/knowledge?view=machine&${query}`, query, brand: brand.id, model: model.id, scope: model.scope,
    level: target?.part ? 'part' : 'component', component: component?.id, part: part?.id };
}

/** A stale or differently scoped response must not become this selection's knowledge count. */
export function partKnowledgeCount(catalog: KnowledgeCatalog | null, lookup: PartKnowledgeLookup): number | null {
  if (lookup.kind !== 'query') return null;
  const selected = catalog?.selected;
  if (!selected || selected.brand !== lookup.brand || selected.model !== lookup.model ||
    selected.component !== lookup.component || selected.part !== lookup.part) return null;
  return new Set(selected.entries.map(entry => entry.entryId)).size;
}
