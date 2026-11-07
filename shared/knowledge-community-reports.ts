import type { KnowledgeRole } from './knowledge-catalog';

/**
 * Community reports (knowledge-base step 4): deterministic topic summaries grouped
 * exactly like the catalog (brand -> model -> component from hierarchy.json).
 * Every sentence cites the archived entries it summarizes; no sentence is generated
 * from an LLM and no new fact is introduced. Reports are only for global questions
 * such as "what problems are common on this machine"; they are never a diagnosis.
 */
export const COMMUNITY_REPORT_FORMULA_VERSION = '1.0.0';

/** Brand kept out of graph/report display by the 2026-11-01 decision; its source entries are not deleted. */
export const COMMUNITY_REPORT_EXCLUDED_BRAND = '千寻位置';

/** Role labels shown in report sentences; order follows the reviewed role order. */
export const COMMUNITY_REPORT_ROLE_LABELS: Record<KnowledgeRole, string> = {
  symptom: '故障表现',
  cause: '候选原因',
  check: '检查步骤',
  action: '处理策略',
  retest: '复检验收',
};

export const COMMUNITY_REPORT_LIMITATIONS: readonly string[] = [
  '社区报告只汇总已有归档条目的主题分布，用于了解该机型该系统常见问题，不用于单次故障确诊。',
  '故障表原因仍为候选，需按型号、排放、配置核对原文；维修、调整与停机策略须遵守对应版本和配置。',
  '计数按已有索引去重；同条证据可关联多个组件和零件，分层计数不可相加。',
  '通识学习条目没有机型与系统归属，不进入社区报告；报告只覆盖来源归档。',
];

export interface CommunityReportSource {
  entry_id: string;
  source_id: string;
  /** Page numbers parsed verbatim from the entry locator; null when the locator carries no PDF pages. */
  pages: { pdf?: string; printed?: string } | null;
  locator: string;
}

export type CommunityReportSentenceKind = 'overview' | 'entry-type' | 'role' | 'source' | 'risk' | 'untagged';

export interface CommunityReportSentence {
  kind: CommunityReportSentenceKind;
  text: string;
  /** Every sentence cites at least one archived entry; the cited set is exactly the set the sentence counts or names. */
  sources: CommunityReportSource[];
}

export interface CommunityReport {
  /** JSON of [brand, model, componentId], the same node-id style as the taxonomy. */
  id: string;
  brand: string;
  model: string;
  componentId: string;
  componentName: string;
  title: string;
  entryCount: number;
  sourceCount: number;
  sentences: CommunityReportSentence[];
  kbVersion: string | null;
  snapshotSha: string;
  status: 'current' | 'stale';
  limitations: readonly string[];
}

export interface CommunityReportSet {
  kbVersion: string | null;
  snapshotSha: string;
  formulaVersion: string;
  status: 'current' | 'stale';
  reports: CommunityReport[];
  totalReports: number;
  /** Distinct archived entries covered by the reports. */
  totalEntries: number;
  degraded: string[];
  limitations: readonly string[];
  page?: { offset: number; limit: number; total: number; hasMore: boolean };
}

/** A report is current only when it was built from exactly this snapshot generation. */
export function isCommunityReportCurrent(
  report: Pick<CommunityReport, 'kbVersion' | 'snapshotSha'>,
  kbVersion: string | null,
  snapshotSha: string,
): boolean {
  return report.kbVersion === kbVersion && report.snapshotSha === snapshotSha;
}

export function describeCommunityReportStaleness(
  report: Pick<CommunityReport, 'kbVersion' | 'snapshotSha'>,
  kbVersion: string | null,
  snapshotSha: string,
): string | null {
  if (isCommunityReportCurrent(report, kbVersion, snapshotSha)) return null;
  return `社区报告绑定的知识快照已变化（报告 kbVersion=${report.kbVersion ?? 'null'} snapshotSha=${report.snapshotSha.slice(0, 12)}，当前 kbVersion=${kbVersion ?? 'null'} snapshotSha=${snapshotSha.slice(0, 12)}），请用当前快照重建，不要使用旧报告。`;
}

const SHA256 = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shape-only validation of a transported report set; source resolution against the snapshot is checked by the builder tests. */
export function validateCommunityReportSet(value: unknown): CommunityReportSet {
  if (!isRecord(value)) throw new TypeError('社区报告格式无效');
  if (value.kbVersion !== null && typeof value.kbVersion !== 'string') throw new TypeError('社区报告 kbVersion 无效');
  if (typeof value.snapshotSha !== 'string' || !SHA256.test(value.snapshotSha)) throw new TypeError('社区报告 snapshotSha 无效');
  if (typeof value.formulaVersion !== 'string' || !value.formulaVersion) throw new TypeError('社区报告 formulaVersion 无效');
  if (value.status !== 'current' && value.status !== 'stale') throw new TypeError('社区报告 status 无效');
  if (!Array.isArray(value.reports)) throw new TypeError('社区报告 reports 无效');
  const ids = new Set<string>();
  for (const report of value.reports) {
    if (!isRecord(report)) throw new TypeError('社区报告条目无效');
    if (typeof report.id !== 'string' || !report.id || ids.has(report.id)) throw new TypeError('社区报告 id 重复或无效');
    ids.add(report.id);
    for (const field of ['brand', 'model', 'componentId', 'componentName', 'title'] as const) {
      if (typeof report[field] !== 'string' || !report[field]) throw new TypeError(`社区报告 ${field} 无效`);
    }
    if (!Number.isSafeInteger(report.entryCount) || (report.entryCount as number) < 1) throw new TypeError('社区报告 entryCount 无效');
    if (!Number.isSafeInteger(report.sourceCount) || (report.sourceCount as number) < 1) throw new TypeError('社区报告 sourceCount 无效');
    if (!Array.isArray(report.sentences) || report.sentences.length === 0) throw new TypeError('社区报告 sentences 无效');
    if (report.kbVersion !== value.kbVersion || report.snapshotSha !== value.snapshotSha) throw new TypeError('社区报告与快照绑定不一致');
    if (report.status !== value.status) throw new TypeError('社区报告状态与集合不一致');
    if (!Array.isArray(report.limitations) || report.limitations.length === 0) throw new TypeError('社区报告 limitations 无效');
    for (const sentence of report.sentences) {
      if (!isRecord(sentence) || typeof sentence.text !== 'string' || !sentence.text.trim()) throw new TypeError('社区报告句子无效');
      if (!['overview', 'entry-type', 'role', 'source', 'risk', 'untagged'].includes(sentence.kind as string)) throw new TypeError('社区报告句子类型无效');
      if (!Array.isArray(sentence.sources) || sentence.sources.length === 0) throw new TypeError('社区报告句子缺少来源');
      for (const source of sentence.sources) {
        if (!isRecord(source) || typeof source.entry_id !== 'string' || !source.entry_id
          || typeof source.source_id !== 'string' || !source.source_id
          || typeof source.locator !== 'string' || !source.locator) throw new TypeError('社区报告来源无效');
        if (source.pages !== null && !isRecord(source.pages)) throw new TypeError('社区报告页码无效');
      }
    }
  }
  if (value.totalReports !== value.reports.length) throw new TypeError('社区报告 totalReports 与实际数量不一致');
  if (!Number.isSafeInteger(value.totalEntries) || (value.totalEntries as number) < 1) throw new TypeError('社区报告 totalEntries 无效');
  if (!Array.isArray(value.degraded) || !Array.isArray(value.limitations) || value.limitations.length === 0) throw new TypeError('社区报告集合字段无效');
  return value as unknown as CommunityReportSet;
}
