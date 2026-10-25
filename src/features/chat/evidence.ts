import type { ChatKnowledgeSource, ChatRoleFlow, FallbackReason } from '../../../shared/chat';
import type { CoordinationDecision } from '../../../shared/diagnosis';
import type { KnowledgeRole } from '../../../shared/knowledge-catalog';

export const EVIDENCE_ROLES: { id: KnowledgeRole; zh: string; en: string }[] = [
  { id: 'symptom', zh: '现象', en: 'Phenomenon' },
  { id: 'cause', zh: '原因', en: 'Cause' },
  { id: 'check', zh: '检查', en: 'Check' },
  { id: 'action', zh: '处理', en: 'Action' },
  { id: 'retest', zh: '复检', en: 'Retest' },
];

export function evidenceRows(flow: ChatRoleFlow | undefined, sources: readonly ChatKnowledgeSource[]) {
  return EVIDENCE_ROLES.map(role => ({
    ...role,
    items: (flow?.[role.id] ?? []).map(step => ({
      ...step,
      source: sources.find(source => source.entryId === step.entryId),
    })),
  }));
}

export type ChatPathBadge = 'source-answer' | 'clarify' | 'ai-assist' | 'safety-fallback';
export function chatPathBadge(coordination?: CoordinationDecision, fallbackReason?: FallbackReason, provider?: string): ChatPathBadge {
  if (fallbackReason || coordination?.route === 'safe') return 'safety-fallback';
  if (coordination?.route === 'clarify') return 'clarify';
  if (coordination?.route === 'ai' || provider === 'gemini' || provider === 'deepseek' || provider === 'openai') return 'ai-assist';
  return 'source-answer';
}
