import fs from 'node:fs';
import path from 'node:path';
import type { CausalEdge, KnowledgeCausalEdges } from '../../shared/knowledge-causal';
import type { KnowledgeChunk } from './types';
import { peekKnowledgeSnapshot, type KnowledgeSnapshot } from './snapshot';

const INDEX_ROOT = path.resolve(process.cwd(), '知识库/整理后的知识库/农用拖拉机知识库');
const CAUSAL_FILE = path.join(INDEX_ROOT, 'causal-edges.json');

const LIMITATIONS = [
  '候选原因只来自知识卡故障表原文，不是确诊；强度只标故障表候选，不代表概率或已验证因果。',
  '措施只对应当条症状的同编号候选原因；阈值只在措施原文给出数值时引用，没有的不补。',
];

const norm = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

function symptomField(text: string): string {
  const match = text.match(/故障现象[：:]\s*([\s\S]*?)(?=\n[-*]\s|$)/);
  return match ? norm(match[1]) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The file keeps the index snake_case convention (like entries.jsonl); the
 * runtime type is camelCase like the rest of the TypeScript code. Validation
 * runs on the file shape, then each edge is mapped once.
 */
type RawCausalEdge = {
  edge_id: string; symptom_entry_id: string; symptom: string; cause: string;
  remedy: string; threshold: string | null; source_id: string;
  pages: { pdf?: string; printed?: string };
  evidence_kind: '故障表' | '知识卡选摘'; strength_basis: '故障表候选';
  brand: string; model: string;
};

function isRawCausalEdge(value: unknown): value is RawCausalEdge {
  if (!isRecord(value)) return false;
  const pages = value.pages;
  return typeof value.edge_id === 'string' && /^CE-\d{6}$/.test(value.edge_id) &&
    typeof value.symptom_entry_id === 'string' && typeof value.symptom === 'string' &&
    typeof value.cause === 'string' && value.cause.length >= 2 &&
    typeof value.remedy === 'string' && value.remedy.length >= 2 &&
    (value.threshold === null || typeof value.threshold === 'string') &&
    typeof value.source_id === 'string' && isRecord(pages) &&
    (typeof pages.pdf === 'string' || typeof pages.printed === 'string') &&
    (value.evidence_kind === '故障表' || value.evidence_kind === '知识卡选摘') &&
    value.strength_basis === '故障表候选' &&
    typeof value.brand === 'string' && typeof value.model === 'string';
}

function toCausalEdge(value: RawCausalEdge): CausalEdge {
  return {
    edgeId: value.edge_id, symptomEntryId: value.symptom_entry_id, symptom: value.symptom,
    cause: value.cause, remedy: value.remedy, threshold: value.threshold,
    sourceId: value.source_id, pages: { ...value.pages },
    evidenceKind: value.evidence_kind, strengthBasis: value.strength_basis,
    brand: value.brand, model: value.model,
  };
}

/**
 * Validate every edge against the loaded snapshot chunks before serving it.
 * An edge survives only when its symptom entry, source, pages, brand/model
 * and verbatim cause/remedy all match the snapshot; anything else is dropped
 * and reported in `degraded`, never served and never allowed to crash the
 * snapshot load. The Python index validator is the merge gate; this is the
 * runtime guard for the same rules.
 */
export function buildCausalEdges(chunks: readonly KnowledgeChunk[], kbVersion: string | null, snapshotSha256: string | null): KnowledgeCausalEdges {
  const degraded: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(CAUSAL_FILE, 'utf8'));
  } catch {
    return { kbVersion, snapshotSha256, edges: [], degraded: ['因果边文件无法读取。'], limitations: LIMITATIONS };
  }
  if (!isRecord(raw) || raw.schema_version !== 1 || !Array.isArray(raw.edges)) {
    return { kbVersion, snapshotSha256, edges: [], degraded: ['因果边文件格式无效。'], limitations: LIMITATIONS };
  }
  const byId = new Map(chunks.filter(chunk => chunk.entryId).map(chunk => [chunk.entryId!, chunk]));
  const seen = new Set<string>();
  const edges: CausalEdge[] = [];
  const dropped: string[] = [];
  for (const value of raw.edges) {
    if (!isRawCausalEdge(value) || seen.has(value.edge_id)) {
      dropped.push(isRecord(value) && typeof value.edge_id === 'string' ? value.edge_id : '?');
      continue;
    }
    seen.add(value.edge_id);
    const edge = toCausalEdge(value);
    const chunk = byId.get(edge.symptomEntryId);
    const headingTitle = chunk?.heading.includes('｜') ? chunk.heading.split('｜').slice(1).join('｜') : chunk?.heading;
    const pagesMatch = chunk?.pages?.pdf === edge.pages.pdf && chunk?.pages?.printed === edge.pages.printed;
    const text = norm(chunk?.text);
    const ok = chunk && chunk.entryType === '维护/故障知识' && chunk.sourceId === edge.sourceId &&
      chunk.brand === edge.brand && chunk.model === edge.model && pagesMatch &&
      (norm(edge.symptom) === norm(headingTitle) || norm(edge.symptom) === symptomField(chunk.text)) &&
      text.includes(norm(edge.cause)) && text.includes(norm(edge.remedy)) &&
      (edge.threshold === null || norm(edge.remedy).includes(norm(edge.threshold)));
    if (!ok) {
      dropped.push(edge.edgeId);
      continue;
    }
    edges.push(Object.freeze({ ...edge, pages: Object.freeze({ ...edge.pages }) }));
  }
  if (dropped.length) {
    degraded.push(`因果边与当前快照不一致，已剔除 ${dropped.length} 条：${dropped.slice(0, 10).join('、')}${dropped.length > 10 ? '…' : ''}。`);
  }
  Object.freeze(edges);
  Object.freeze(degraded);
  return Object.freeze({ kbVersion, snapshotSha256, edges, degraded, limitations: LIMITATIONS });
}

const cache = new WeakMap<KnowledgeSnapshot, KnowledgeCausalEdges>();

export function causalEdgesForSnapshot(snapshot: KnowledgeSnapshot): KnowledgeCausalEdges {
  const existing = cache.get(snapshot);
  if (existing) return existing;
  const result = buildCausalEdges(snapshot.chunks, snapshot.kbVersion, snapshot.snapshotSha256);
  cache.set(snapshot, result);
  return result;
}

export function getCausalEdges(): KnowledgeCausalEdges {
  const snapshot = peekKnowledgeSnapshot();
  if (!snapshot) {
    return { kbVersion: null, snapshotSha256: null, edges: [], degraded: ['知识快照尚未加载。'], limitations: LIMITATIONS };
  }
  return causalEdgesForSnapshot(snapshot);
}

/** Expand only the retrieved, already hard-filtered chunks along their causal edges. */
export function causalEdgesForChunks(chunks: readonly KnowledgeChunk[], causal: KnowledgeCausalEdges): CausalEdge[] {
  const byEntry = new Map<string, CausalEdge[]>();
  for (const edge of causal.edges) {
    const list = byEntry.get(edge.symptomEntryId) ?? [];
    list.push(edge);
    byEntry.set(edge.symptomEntryId, list);
  }
  const out: CausalEdge[] = [];
  for (const chunk of chunks) {
    if (chunk.entryId) out.push(...(byEntry.get(chunk.entryId) ?? []));
  }
  return out;
}

/** Prompt block: candidates for the LLM to re-rank, never a confirmed diagnosis. */
export function formatCausalEdgesForPrompt(edges: readonly CausalEdge[]): string {
  if (!edges.length) return '';
  const lines = edges.map(edge =>
    `- ${edge.symptomEntryId}｜${edge.symptom} → 候选原因：${edge.cause}；措施：${edge.remedy}` +
    `${edge.threshold ? `；阈值（措施原文）：${edge.threshold}` : ''}（来源 ${edge.sourceId}，PDF 第 ${edge.pages.pdf ?? '—'} 页 / 印刷第 ${edge.pages.printed ?? '—'} 页；${edge.evidenceKind}，未确诊）`);
  return `【因果候选（故障表，未确诊）】\n以下候选只来自本次命中条目的知识卡故障表原文，先按型号/排放/配置硬过滤后展开；只可按所列候选重排并写解释，不得新增原因、不得把候选写成确诊、不得把阈值当作本机实测值：\n${lines.join('\n')}`;
}
