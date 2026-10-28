import { loadKnowledgeBase, retrieve } from '../../server/knowledge/retriever';
import { hasIndexedReference, referenceVerification } from '../../server/knowledge/evidence';
import type { KnowledgeChunk } from '../../server/knowledge/types';

export interface StrictSearchInput {
  query: string;
  machine: { brand?: string; model?: string; engineModel?: string };
  faultCode?: string;
  topK?: number;
}
export interface Citation {
  chunk_id: string; doc_title: string; section_path: string; page: string | null;
  version: string | null; model_match: 'exact'; score: number; snippet: string;
}
export interface StrictSearchResult {
  status: 'identity_required' | 'insufficient_evidence' | 'results';
  evidence_level: '不足' | '部分'; reason: string; citations: Citation[];
}
const normal = (value: string) => value.normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');

/** Isolated, conservative adapter: no model-less retrieval or inferred fault-code meaning. */
export function createStrictSearch(search: typeof retrieve = retrieve, initialize: () => unknown = loadKnowledgeBase) {
  return (input: StrictSearchInput): StrictSearchResult => {
    const brand = input.machine?.brand?.trim();
    const model = input.machine?.model?.trim();
    if (!brand || !model) return { status: 'identity_required', evidence_level: '不足', reason: '请提供品牌和完整型号。', citations: [] };
    const query = input.query?.trim();
    if (!query) return { status: 'insufficient_evidence', evidence_level: '不足', reason: '请补充故障现象或问题。', citations: [] };
    const limit = Math.min(10, Math.max(1, Math.floor(Number.isFinite(input.topK) ? input.topK! : 5)));
    initialize();
    const code = input.faultCode?.trim();
    const candidates = search(query, 100, { brand, model, engineModel: input.machine.engineModel, ...(code ? { faultCodes: [code] } : {}) });
    const admissible = candidates.filter((chunk: KnowledgeChunk) => hasIndexedReference(chunk) &&
      chunk.applicability === 'matched' && chunk.retrieval?.tier === 'exact' && !chunk.retrieval.referenceOnly &&
      referenceVerification(chunk.status) === 'verified' && chunk.diagnosticEvidence !== false &&
      (!input.machine.engineModel || (chunk.engineModel && normal(chunk.engineModel) === normal(input.machine.engineModel))) &&
      (!code || chunk.faultCodes?.some(item => normal(item) === normal(code))));
    const citations = admissible.slice(0, limit).map(chunk => ({
      chunk_id: chunk.entryId!, doc_title: chunk.sourceTitle ?? chunk.sourceId!, section_path: chunk.locator ?? chunk.heading,
      page: chunk.pages?.pdf ?? null, version: chunk.version ?? null, model_match: 'exact' as const,
      score: chunk.relevance?.score ?? 0, snippet: chunk.text.slice(0, 500),
    }));
    return citations.length
      ? { status: 'results', evidence_level: '部分', reason: '资料匹配不等于故障已确认；仍须核对年份、配置及证据覆盖。', citations }
      : { status: 'insufficient_evidence', evidence_level: '不足', reason: '知识库中未找到可靠依据；请补充机型配置、故障码及发生条件。', citations: [] };
  };
}
