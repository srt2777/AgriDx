import type { KnowledgeCatalog } from '../../shared/knowledge-catalog';
import type { KnowledgeRelations, RelationEdge } from '../../shared/knowledge-relations';
import { RELATION_FORMULA_VERSION, membershipStrength, componentStrength, roleSimilarity } from '../../shared/relation-strength';
import { taxonomyNodes, type TaxonomyNode } from '../../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { getKnowledgeCatalog } from './catalog';
import { semanticRelations, type SemanticRelationsInput } from './relations-semantic';
import { peekKnowledgeSnapshot } from './snapshot';

const cache = new WeakMap<KnowledgeCatalog, KnowledgeRelations>();
/** Builds from exactly the catalog generation held by the active knowledge snapshot. */
export function buildKnowledgeRelations(catalog: KnowledgeCatalog, semantic: SemanticRelationsInput = {}): KnowledgeRelations {
  const nodes = taxonomyNodes(catalog).filter(node => node.query.brand !== '千寻位置');
  const byId = new Map(nodes.map(node => [node.id, node]));
  const membership = new Map<string, number>();
  const edges: RelationEdge[] = [];
  for (const node of nodes) {
    if (!node.parent) continue;
    const parent = byId.get(node.parent);
    if (!parent) continue;
    const strength = membershipStrength(parent.count, node.count);
    membership.set(node.id, strength);
    edges.push({ from: parent.id, to: node.id, type: 'membership', strength, basis: '目录归属', evidence: { parentCount: parent.count, childCount: node.count } });
  }
  const names = new Map<string, TaxonomyNode[]>();
  for (const node of nodes) {
    if (node.level !== 'part' && node.level !== 'component') continue;
    const key = JSON.stringify([node.level, node.label]);
    const group = names.get(key) ?? []; group.push(node); names.set(key, group);
  }
  for (const group of names.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j];
    if (a.query.brand === b.query.brand && a.query.model === b.query.model) continue;
    const aMembership = membership.get(a.id) ?? 0, bMembership = membership.get(b.id) ?? 0;
    edges.push({ from: a.id, to: b.id, type: 'shared-component',
      strength: componentStrength(a.count, b.count, a.roleCoverage, b.roleCoverage, aMembership, bMembership),
      basis: '跨机型同名部件', evidence: { name: a.label, leftCount: a.count, rightCount: b.count,
        roleCoverageSimilarity: roleSimilarity(a.roleCoverage, b.roleCoverage), leftMembership: aMembership, rightMembership: bMembership } });
  }
  const candidates = semanticRelations(semantic, new Set(nodes.map(node => node.id)));
  edges.push(...candidates.edges);
  for (const edge of edges) { Object.freeze(edge.evidence); Object.freeze(edge); }
  Object.freeze(edges);
  const result: KnowledgeRelations = { kbVersion: catalog.kbVersion ?? null, formulaVersion: RELATION_FORMULA_VERSION,
    nodes: nodes.map(node => node.id), edges,
    degraded: candidates.degraded,
    limitations: ['启发式强度仅表示资料关联紧密度，不代表概率、维修因果、先修关系、适用性或兼容性。'] };
  Object.freeze(result.nodes); Object.freeze(result.degraded); Object.freeze(result.limitations);
  return Object.freeze(result);
}
export function relationsForCatalog(catalog: KnowledgeCatalog): KnowledgeRelations {
  const existing = cache.get(catalog);
  if (existing) return existing;
  const snapshot = peekKnowledgeSnapshot();
  const result = buildKnowledgeRelations(catalog, snapshot?.getCatalog() === catalog ? snapshot.semantic : {}); cache.set(catalog, result); return result;
}
export function getKnowledgeRelations(): KnowledgeRelations { return relationsForCatalog(getKnowledgeCatalog()); }
/** Optional deterministic paging avoids forcing clients to receive the complete graph at once. */
export function pageKnowledgeRelations(relations: KnowledgeRelations, params: URLSearchParams): KnowledgeRelations {
  if (!params.has('offset') && !params.has('limit')) return relations;
  if (params.getAll('offset').length > 1 || params.getAll('limit').length > 1) throw new RangeError('关系分页参数不能重复。');
  const rawOffset = params.get('offset') ?? '0', rawLimit = params.get('limit') ?? '2000';
  if (!/^(0|[1-9]\d{0,8})$/.test(rawOffset) || !/^[1-9]\d{0,4}$/.test(rawLimit)) throw new RangeError('关系分页参数无效。');
  const offset = Number(rawOffset), limit = Number(rawLimit);
  if (limit > 10000 || offset > relations.edges.length) throw new RangeError('关系分页超出范围。');
  return { ...relations, edges: relations.edges.slice(offset, offset + limit), page: { offset, limit, total: relations.edges.length, hasMore: offset + limit < relations.edges.length } };
}
