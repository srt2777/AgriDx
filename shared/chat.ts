import type { MemorySession, PriorDeviceReport } from './memory';
import type { CoordinationDecision, DiagnosisMode } from './diagnosis';
import type { KnowledgePages, KnowledgeRole } from './knowledge-catalog';
/** Public chat protocol. Provider prompts and credentials remain server-only. */
export type ChatProvider = 'gemini' | 'deepseek' | 'knowledge-base';
export type AnswerMode = 'knowledge-grounded' | 'general-guidance' | 'local-evidence';
export type FallbackReason = 'not_configured' | 'provider_unavailable';

export interface ChatApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MachineContext {
  machineType: string;
  brand: string;
  model: string;
}

export interface ChatRequest {
  diagnosisMode?: DiagnosisMode;
  sessionId?: string;
  revision?: number;
  messages: ChatApiMessage[];
  machineType?: string;
  brand?: string;
  model?: string;
  engineModel?: string;
  faultCodes?: string[];
}

export interface ChatKnowledgeSource {
  entryId?: string;
  entryType?: string;
  diagnosticEvidence?: false;
  /** 2026-10-22: TK used as general-knowledge evidence for an open (no brand/model) question. */
  generalEvidence?: true;
  /** archive = book entry with title/page; general-knowledge = 通识, no manual page; prompt = collection hint. */
  evidenceKind?: 'archive' | 'general-knowledge' | 'prompt';
  /** Human label: 通识 entries read “通识（无手册页码）”. */
  evidenceLabel?: string;
  sourceId?: string;
  source: string;
  heading: string;
  locator?: string;
  version?: string;
  applicability?: 'matched' | 'pending';
  status?: string;
  referenceVerification?: 'verified' | 'pending' | 'unverified' | 'unspecified' | 'failed';
  sourceIndexed?: boolean;
  sourceTitle?: string;
  scopeBoundary?: string;
  models?: string[];
  engineModel?: string;
  faultCodes?: string[];
  pages?: KnowledgePages;
  roles?: KnowledgeRole[];
  roleBasis?: '原文标记' | '人工核对';
  riskLevel?: 'high' | 'medium' | 'low';
}

export interface ChatRoleFlowStep {
  entryId: string;
  heading: string;
  sourceId?: string;
  sourceTitle?: string;
  pages?: KnowledgePages;
  locator?: string;
}
/** Displayed evidence grouped as symptom -> cause/check -> action -> retest (reviewed roles only). */
export type ChatRoleFlow = Record<KnowledgeRole, ChatRoleFlowStep[]> & { untaggedEntryIds: string[]; generalKnowledgeIds?: string[] };

export interface ChatResponse {
  diagnosisTrace?: DiagnosisTrace;
  coordination?: CoordinationDecision;
  coordinationMessage?: string;
  localSummary?: string;
  memory?: MemorySession;
  relatedMemoryReports?: PriorDeviceReport[];
  choices: { message: { role: 'assistant'; content: string } }[];
  model: string;
  provider: ChatProvider;
  answerMode: AnswerMode;
  fellBack: boolean;
  knowledgeChunks: number;
  knowledgeSources: ChatKnowledgeSource[];
  roleFlow?: ChatRoleFlow;
  fallbackReason?: FallbackReason;
}

/** Timing is measured on the executing server; scores are retrieval matches, not accuracy. */
export interface DiagnosisTrace {
  retrievalCount: number;
  aiAttempts: number;
  aiSuccesses: number;
  aiProvider: 'gemini' | 'deepseek' | null;
  scoreMethod: 'keyword-weighted-overlap';
  contextChars: number;
  sentKnowledgeIds: string[];
  timings: { retrievalMs: number; decisionMs: number; externalAiMs: number; totalMs: number };
}

export interface LlmHealth {
  allowExternalAi?: boolean;
  defaultMode?: DiagnosisMode;
  configured: boolean;
  primary: 'gemini' | 'deepseek' | null;
}
