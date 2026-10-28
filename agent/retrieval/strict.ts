import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BM25Index, normalizeQuery, fuseRankings, type SynonymGroup } from './lexical';
import { loadKnowledgeBase, retrieve } from '../../server/knowledge/retriever';
import { hasIndexedReference, referenceVerification } from '../../server/knowledge/evidence';
import { archiveApplicability, resolveScope, queryWithoutIdentity } from '../../server/knowledge/scope';
import { peekKnowledgeSnapshot } from '../../server/knowledge/snapshot';
import { suspiciousInstructions } from '../security/guard';
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
  source_id: string; scope_boundary: string | null;
}
export interface StrictSearchResult {
  status: 'identity_required' | 'insufficient_evidence' | 'results';
  evidence_level: '不足' | '部分'; reason: string; citations: Citation[];
  channel?: 'fault_code_exact' | 'keyword' | 'bm25_keyword_rrf'; quarantined?: number;
}
const indexes = new WeakMap<readonly KnowledgeChunk[], BM25Index>();
const identity = (value: string) => value.normalize('NFKC').toUpperCase().replace(/\s/g, '');
export function normalizeFaultCode(value: string): string {
  const code = value.normalize('NFKC').trim().toUpperCase();
  const spn = /^SPN\s*[:=]?\s*(\d+)\s*[,;/ -]+\s*FMI\s*[:=]?\s*(\d+)$/.exec(code);
  return spn ? `SPN:${spn[1]}/FMI:${spn[2]}` : code.replace(/\s/g, '');
}

/** Exact codes scan the entire published generation before symptom ranking; model scope is independently rechecked. */
export function createStrictSearch(
  search: typeof retrieve = retrieve,
  initialize: () => unknown = loadKnowledgeBase,
  documents?: () => readonly KnowledgeChunk[],
) {
  const all = documents ?? (search === retrieve ? () => peekKnowledgeSnapshot()?.chunks ?? [] : undefined);
  return (input: StrictSearchInput): StrictSearchResult => {
    const brand = input.machine?.brand?.trim(); const model = input.machine?.model?.trim();
    if (!brand || !model) return { status: 'identity_required', evidence_level: '不足', reason: '请提供品牌和完整型号。', citations: [] };
    const query = input.query?.trim();
    if (!query) return { status: 'insufficient_evidence', evidence_level: '不足', reason: '请补充故障现象或问题。', citations: [] };
    const limit = Math.min(10, Math.max(1, Math.floor(Number.isFinite(input.topK) ? input.topK! : 5)));
    initialize();
    const code = input.faultCode?.trim();
    const scopeQuery = code ? query.replace(new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ') : query;
    const scope = resolveScope(scopeQuery, { brand, model });
    if (scope.identityConflict || scope.ambiguous) return { status: 'identity_required', evidence_level: '不足', reason: '问题中的机型与已填档案冲突，请先确认本次设备。', citations: [] };
    let channel: NonNullable<StrictSearchResult['channel']> = code ? 'fault_code_exact' : 'keyword';
    let candidates: readonly KnowledgeChunk[];
    const fusionScores = new Map<KnowledgeChunk, number>();
    if (code && all) candidates = all();
    else {
      const keyword = search(query, 100, { brand, model, engineModel: input.machine.engineModel, ...(code ? { faultCodes: [code] } : {}) });
      if (!code && all) {
        const chunks = all(); let index = indexes.get(chunks);
        if (!index) { index = new BM25Index(chunks); indexes.set(chunks, index); }
        // Fixed trusted file. Invalid glossary fails the tool; no silent success with a broken dictionary.
        const glossary: SynonymGroup[] = JSON.parse(readFileSync(path.join(process.cwd(), 'data/agent-glossary.json'), 'utf8'));
        if (!Array.isArray(glossary) || glossary.some(group => typeof group.canonical !== 'string' || !Array.isArray(group.aliases) || group.aliases.some(alias => typeof alias !== 'string'))) throw new Error('术语词典格式无效');
        const rewritten = normalizeQuery(queryWithoutIdentity(query).replace(/请问|怎么办|怎么修|我的|这台|拖拉机/g, ' '), glossary);
        const bm25 = index.search(rewritten, chunk => archiveApplicability(chunk, scope) === 'matched');
        candidates = fuseRankings([keyword.map(chunk => ({chunk,score:chunk.relevance?.score??0})),bm25]).map(({chunk,score}) => { const candidate = {...chunk, applicability:'matched' as const}; fusionScores.set(candidate,score); return candidate; });
        channel = 'bm25_keyword_rrf';
      } else candidates = keyword;
    }
    let quarantined = 0;
    const admissible = candidates.filter((chunk: KnowledgeChunk) => {
      if (!hasIndexedReference(chunk) || archiveApplicability(chunk, scope) !== 'matched' ||
        referenceVerification(chunk.status) !== 'verified' || chunk.diagnosticEvidence === false ||
        (!code && (chunk.retrieval?.referenceOnly || chunk.applicability !== 'matched')) ||
        (input.machine.engineModel && (!chunk.engineModel || identity(chunk.engineModel) !== identity(input.machine.engineModel))) ||
        (code && !chunk.faultCodes?.some(item => normalizeFaultCode(item) === normalizeFaultCode(code)))) return false;
      if (suspiciousInstructions(chunk.text)) { quarantined++; return false; }
      return true;
    });
    const seen = new Set<string>();
    const citations = admissible.filter(chunk => {
      const key = JSON.stringify([chunk.entryId, chunk.version]);
      if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, limit).map(chunk => ({
      chunk_id: chunk.entryId!, doc_title: chunk.sourceTitle ?? chunk.sourceId!, section_path: chunk.locator ?? chunk.heading,
      page: chunk.pages?.pdf ?? null, version: chunk.version ?? null, model_match: 'exact' as const,
      score: fusionScores.get(chunk) ?? chunk.relevance?.score ?? 0, snippet: chunk.text,
      source_id: chunk.sourceId!, scope_boundary: chunk.scopeBoundary ?? null,
    }));
    return citations.length
      ? { status: 'results', evidence_level: '部分', reason: '资料匹配不等于故障已确认；仍须核对年份、配置、版本冲突及证据覆盖。', citations, channel, quarantined }
      : { status: 'insufficient_evidence', evidence_level: '不足', reason: '知识库中未找到可靠依据；请补充机型配置、故障码及发生条件。', citations: [], channel, quarantined };
  };
}
