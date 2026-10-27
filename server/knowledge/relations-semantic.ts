import type { RelationEdge } from '../../shared/knowledge-relations';
import { SEMANTIC_RELATION_WEIGHTS } from '../../shared/relation-strength';

export interface SemanticCandidateReport {
  schema_version: number;
  snapshot?: { sha256?: string };
  example?: { omitted_relations?: number };
  relations?: Array<{ relation_id?: string; relation?: string; review_state?: string; left_entry_id?: string; right_entry_id?: string }>;
}
export interface SemanticRelationsInput {
  report?: SemanticCandidateReport | null;
  snapshotSha256?: string | null;
  reason?: string;
  entryNodes?: ReadonlyMap<string, readonly string[]>;
}
/** Report validity is checked against the exact audited snapshot, never kbVersion alone. */
export function semanticRelations(input: SemanticRelationsInput, validNodes: ReadonlySet<string>): { edges: RelationEdge[]; degraded: string[] } {
  const { report, snapshotSha256, entryNodes } = input;
  if (!report) return { edges: [], degraded: [input.reason || '语义审核报告未提供。'] };
  if (!snapshotSha256 || !/^[a-f0-9]{64}$/.test(snapshotSha256) || report.snapshot?.sha256 !== snapshotSha256) return { edges: [], degraded: ['语义审核报告与当前快照不匹配或未能核验。'] };
  if (report.schema_version !== 1 || !Array.isArray(report.relations) || (report.example?.omitted_relations ?? 0) > 0 || !entryNodes) return { edges: [], degraded: ['语义审核报告不完整或无法映射到目录节点。'] };
  const grouped = new Map<string, { from: string; to: string; relation: string; ids: Set<string> }>();
  for (const item of report.relations) {
    if (!item || item.review_state !== 'pending' || typeof item.relation !== 'string' || !Object.hasOwn(SEMANTIC_RELATION_WEIGHTS, item.relation) ||
        typeof item.relation_id !== 'string' || !item.relation_id || typeof item.left_entry_id !== 'string' || typeof item.right_entry_id !== 'string') return { edges: [], degraded: ['语义审核报告格式或审核状态无效。'] };
    for (const left of entryNodes.get(item.left_entry_id) ?? []) for (const right of entryNodes.get(item.right_entry_id) ?? []) {
      if (left === right || !validNodes.has(left) || !validNodes.has(right)) continue;
      const [from,to] = [left,right].sort(), key = JSON.stringify([from,to,item.relation]);
      const current = grouped.get(key) ?? { from, to, relation: item.relation, ids: new Set<string>() };
      current.ids.add(item.relation_id); grouped.set(key,current);
    }
  }
  const edges = [...grouped.values()].sort((a,b) => {
    const left = JSON.stringify([a.from,a.to,a.relation]), right = JSON.stringify([b.from,b.to,b.relation]);
    return left < right ? -1 : left > right ? 1 : 0;
  }).map(({from,to,relation,ids}) => ({
    from, to, type: 'semantic' as const, strength: SEMANTIC_RELATION_WEIGHTS[relation] * (1 - 1 / (1 + ids.size)), basis: '语义候选（待审核）',
    evidence: { relation, reviewState: 'pending', relationCount: ids.size, relationIds: [...ids].sort().join(',') },
  }));
  return { edges, degraded: [] };
}
