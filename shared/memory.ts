import type { ChatKnowledgeSource, ChatRoleFlow, DiagnosisTrace } from './chat';
import type { CoordinationDecision, DiagnosticReply } from './diagnosis';
/** Business memory is user-reported data, never verified repair evidence. */
export interface DeviceProfile {
  name: string;
  machineType: string;
  brand: string;
  model: string;
  hours: number | null;
  notes: string;
}
export interface MemoryDevice extends DeviceProfile {
  id: string;
  updatedAt: string;
}
export interface MemoryMessage {
  diagnosticReply?: DiagnosticReply;
  knowledgeSources?: ChatKnowledgeSource[];
  coordination?: CoordinationDecision;
  diagnosisTrace?: DiagnosisTrace;
  roleFlow?: ChatRoleFlow;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  model?: string;
  provider?: 'gemini' | 'deepseek' | 'openai' | 'knowledge-base';
  localSummary?: string;
  coordinationMessage?: string;
  answerMode?: 'knowledge-grounded' | 'general-guidance' | 'local-evidence';
  fallbackReason?: 'not_configured' | 'provider_unavailable';
  knowledgeChunks?: number;
}
export interface MemorySession {
  id: string;
  deviceId: string;
  title: string;
  progress: string;
  summary: string;
  revision: number;
  updatedAt: string;
}
export interface SessionDetail extends MemorySession {
  device: MemoryDevice;
  messages: MemoryMessage[];
}
export interface MemoryOverview {
  devices: MemoryDevice[];
  sessions: MemorySession[];
}
export interface PriorDeviceReport {
  sessionId: string;
  updatedAt: string;
  question: string;
  progress: string;
}
/** Long-term memory: cross-session user-reported facts. Promoted never means verified. */
/** Max promoted long-term entries included in a prompt (kept in shared/memory so browser bundles never import the server SQLite store). */
export const LONG_TERM_PROMPT_MAX = 5;
export type LongTermKind = 'device_fact' | 'fault_pattern';
export type LongTermStatus = 'candidate' | 'promoted' | 'demoted' | 'stale' | 'superseded';
export interface LongTermEntry {
  id: string;
  deviceId: string;
  kind: LongTermKind;
  content: string;
  source: 'user_reported';
  status: LongTermStatus;
  /** Distinct sessions that confirmed this entry; promotion needs >= 2. */
  confirmations: number;
  evidenceSessions: string[];
  reason: string;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastConfirmedAt: string;
}
