import type { KnowledgeRelations, RelationType } from '../../../shared/knowledge-relations';
import { isRecord, requestJson } from '../../lib/api-client';

/** Reject malformed, nonfinite or noncatalog relationships before rendering. */
export function parseKnowledgeRelations(value: unknown, catalogNodeIds: ReadonlySet<string>): KnowledgeRelations {
  if (!isRecord(value) || (value.kbVersion !== null && typeof value.kbVersion !== 'string') ||
      typeof value.formulaVersion !== 'string' || !Array.isArray(value.nodes) || !Array.isArray(value.edges) ||
      !Array.isArray(value.degraded) || !value.degraded.every(item => typeof item === 'string') ||
      !Array.isArray(value.limitations) || !value.limitations.every(item => typeof item === 'string')) throw new Error('Invalid knowledge relations');
  if (value.page !== undefined) {
    const page = value.page;
    if (!isRecord(page) || !Number.isSafeInteger(page.offset) || Number(page.offset) < 0 || !Number.isSafeInteger(page.limit) || Number(page.limit) < 1 || Number(page.limit) > 10000 ||
        !Number.isSafeInteger(page.total) || Number(page.total) < 0 || Number(page.offset) > Number(page.total) || typeof page.hasMore !== 'boolean' ||
        page.hasMore !== (Number(page.offset) + Number(page.limit) < Number(page.total)) || value.edges.length !== Math.min(Number(page.limit), Number(page.total) - Number(page.offset))) throw new Error('Invalid relation page');
  }
  const nodes = new Set<string>();
  for (const node of value.nodes) {
    if (typeof node !== 'string' || !catalogNodeIds.has(node) || nodes.has(node)) throw new Error('Invalid relation node');
    nodes.add(node);
  }
  if (nodes.size !== catalogNodeIds.size) throw new Error('Relation nodes do not match catalog');
  const seen = new Set<string>();
  for (const edge of value.edges) {
    if (!isRecord(edge) || typeof edge.from !== 'string' || typeof edge.to !== 'string' || edge.from === edge.to ||
        !nodes.has(edge.from) || !nodes.has(edge.to) || !['membership', 'shared-component', 'semantic'].includes(String(edge.type)) ||
        typeof edge.strength !== 'number' || !Number.isFinite(edge.strength) || edge.strength < 0 || edge.strength > 1 ||
        typeof edge.basis !== 'string' || !edge.basis.trim() || !isRecord(edge.evidence) || !Object.keys(edge.evidence).length ||
        Object.values(edge.evidence).some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item) || typeof item === 'number' && !Number.isFinite(item))) throw new Error('Invalid relation edge');
    const type = edge.type as RelationType;
    if (type === 'semantic' && edge.evidence.reviewState !== 'pending') throw new Error('Semantic relation must be pending');
    const pair = type === 'membership' ? [edge.from, edge.to] : [edge.from, edge.to].sort();
    const key = JSON.stringify([type, ...pair, type === 'semantic' ? edge.evidence.relation : null]);
    if (seen.has(key)) throw new Error('Duplicate relation edge');
    seen.add(key);
  }
  return value as unknown as KnowledgeRelations;
}
export async function fetchKnowledgeRelations(nodeIds: ReadonlySet<string>, signal?: AbortSignal, page?: { offset: number; limit: number }): Promise<KnowledgeRelations> {
  const query = page ? `?${new URLSearchParams({ offset: String(page.offset), limit: String(page.limit) })}` : '';
  return parseKnowledgeRelations(await requestJson(`/api/knowledge/relations${query}`, { signal }), nodeIds);
}
