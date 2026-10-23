import type { RetrievalBasis } from '../../shared/diagnosis';

export interface KnowledgeChunk {
  /** 通用文档相对 server/knowledge；归档文档相对仓库根目录 */
  source: string;
  /** 该块所属章节标题（## 级） */
  heading: string;
  /** 块正文 */
  text: string;
  entryId?: string;
  sourceId?: string;
  /** Bound by the archive loader after checking the entry, source and section. */
  indexedReference?: Readonly<{ entryId: string; sourceId: string }>;
  brand?: string;
  model?: string;
  /** Only populated when declared by the source; never inferred from the model name. */
  engineModel?: string;
  faultCodes?: string[];
  models?: string[];
  /** Entry-specific subsets require an exact identity rather than a brand-only match. */
  requiresExactModel?: boolean;
  configuration?: 'CAB' | 'ROPS';
  driveConfiguration?: '2WD' | '4WD';
  emissionStage?: '国三' | '国四';
  /** Unresolved source evidence forbids inferring emissions from a model suffix. */
  emissionStageUnknown?: boolean;
  sourceUrl?: string;
  originalPath?: string;
  locator?: string;
  version?: string;
  scopeBoundary?: string;
  status?: string;
  entryType?: string;
  /** Book/web title from sources.json; recorded as on the cover, never translated. */
  sourceTitle?: string;
  /** Page numbers parsed verbatim from the locator. */
  pages?: { pdf?: string; printed?: string };
  /** Reviewed roles from entry-roles.jsonl; absent = not yet tagged (never "none"). */
  roles?: ('symptom' | 'cause' | 'check' | 'action' | 'retest')[];
  roleBasis?: '原文标记' | '人工核对';
  riskLevel?: 'high' | 'medium' | 'low';
  riskBasis?: string;
  /** General principles may inform analysis, but never prove model-specific repairs. */
  diagnosticEvidence?: false;
  /**
   * Set at retrieval time only (never in entry files): when the question names no brand or
   * model, 通识 (TK) entries count as general-knowledge evidence (user decision 2026-10-22).
   * Such evidence has no manual page and must be labelled 通识, never as a manual statement.
   */
  generalEvidence?: true;
  applicability?: 'matched' | 'pending';
  diagnosticMetadata?: DiagnosticMetadata;
  /** This is a raw lexical match score, not a percentage or diagnostic probability. */
  relevance?: { score: number; method: 'keyword-weighted-overlap'; calibrated: false };
  /** Runtime retrieval provenance; never changes the archived scope or review status. */
  retrieval?: RetrievalBasis;
}

export interface DiagnosticMetadata {
  coverage: { symptom: boolean; causes: boolean; checks: boolean; repair: boolean };
  riskLevel: 'low' | 'high' | 'unknown';
}

