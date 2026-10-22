import type { KnowledgeChunk } from './types';
import type { KnowledgeRole, KnowledgePages } from '../../shared/knowledge-catalog';

export interface RoleFlowStep {
  entryId: string;
  heading: string;
  sourceId?: string;
  sourceTitle?: string;
  pages?: KnowledgePages;
  locator?: string;
}
/** symptom -> cause/check -> action -> retest, built only from reviewed roles (entry-roles.jsonl). */
/** generalKnowledgeIds: 通识 evidence (no manual page) kept apart from book-cited steps. */
export type RoleFlow = Record<KnowledgeRole, RoleFlowStep[]> & { untaggedEntryIds: string[]; generalKnowledgeIds: string[] };

const ORDER: KnowledgeRole[] = ['symptom', 'cause', 'check', 'action', 'retest'];
const LABELS: Record<KnowledgeRole, string> = { symptom: '现象', cause: '可能原因', check: '检查', action: '处理', retest: '复检' };

export function buildRoleFlow(chunks: KnowledgeChunk[]): RoleFlow {
  const flow: RoleFlow = { symptom: [], cause: [], check: [], action: [], retest: [], untaggedEntryIds: [], generalKnowledgeIds: [] };
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.entryId && chunk.generalEvidence && !seen.has(chunk.entryId)) { seen.add(chunk.entryId); flow.generalKnowledgeIds.push(chunk.entryId); continue; }
    if (!chunk.entryId || chunk.diagnosticEvidence === false || seen.has(chunk.entryId)) continue;
    seen.add(chunk.entryId);
    if (!chunk.roles?.length) { flow.untaggedEntryIds.push(chunk.entryId); continue; }
    const step: RoleFlowStep = {
      entryId: chunk.entryId, heading: chunk.heading,
      ...(chunk.sourceId ? { sourceId: chunk.sourceId } : {}),
      ...(chunk.sourceTitle ? { sourceTitle: chunk.sourceTitle } : {}),
      ...(chunk.pages ? { pages: { ...chunk.pages } } : {}),
      ...(chunk.locator ? { locator: chunk.locator } : {}),
    };
    for (const role of chunk.roles) flow[role].push(step);
  }
  return flow;
}

export function hasRoleFlow(flow: RoleFlow): boolean {
  return ORDER.some((role) => flow[role].length > 0);
}

export function citeStep(step: RoleFlowStep): string {
  const pages = [step.pages?.pdf && `PDF 第 ${step.pages.pdf} 页`, step.pages?.printed && `印刷第 ${step.pages.printed} 页`].filter(Boolean).join('／');
  return `${step.entryId}《${step.sourceTitle ?? step.sourceId ?? '来源待核实'}》${pages ? ` ${pages}` : ''}`;
}

/** Markdown outline: which retrieved entries hold which role, with book title and page. No new facts. */
export function formatRoleFlow(flow: RoleFlow): string {
  const groups: [string, KnowledgeRole[]][] = [['现象', ['symptom']], ['原因／检查', ['cause', 'check']], ['处理', ['action']], ['复检', ['retest']]];
  const lines: string[] = [];
  for (const [title, roles] of groups) {
    const items = roles.flatMap((role) => flow[role].map((step) => `  - ${LABELS[role]}：${citeStep(step)}`));
    if (items.length) lines.push(`- ${title}`, ...items);
  }
  if (flow.generalKnowledgeIds?.length) lines.push(`- 通识依据（通识·无手册页码）：${flow.generalKnowledgeIds.join('、')}`);
  return lines.join('\n');
}
