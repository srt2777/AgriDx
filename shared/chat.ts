import type { MemorySession, PriorDeviceReport } from './memory';
import type { CoordinationDecision, DiagnosisMode, DiagnosticReply, RetrievalBasis } from './diagnosis';
import type { KnowledgePages, KnowledgeRole } from './knowledge-catalog';
/** Public chat protocol. Provider prompts and credentials remain server-only. */
export type ChatProvider = 'gemini' | 'deepseek' | 'openai' | 'knowledge-base';
export type AnswerMode = 'knowledge-grounded' | 'general-guidance' | 'local-evidence';
export type FallbackReason = 'not_configured' | 'provider_unavailable';

export interface ChatApiMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface ChatTelemetrySummary { source: 'simulated'; text: string }

export interface MachineContext {
  machineType: string;
  brand: string;
  model: string;
  engineModel?: string;
  faultCodes?: string[];
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
  telemetrySummary?: ChatTelemetrySummary;
}

export interface ChatKnowledgeSource {
  retrieval?: RetrievalBasis;
  /** A prompt candidate is not proof that every generated claim is supported. */
  usage?: 'answer-evidence' | 'prompt-context' | 'reference-only';
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
  diagnosticReply?: DiagnosticReply;
  diagnosisTrace?: DiagnosisTrace;
  coordination?: CoordinationDecision;
  coordinationMessage?: string;
  localSummary?: string;
  memory?: MemorySession;
  /**
   * True when the answer was generated but its turn could not be saved to
   * the diagnosis record (storage failure, revision conflict, or record
   * limit). The answer is still valid; the client keeps its old revision
   * so the next turn can retry against the last saved revision.
   */
  memorySaveFailed?: boolean;
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
export interface MainLoopToolEvent {
  step: number;
  tool: string;
  ok: boolean;
  error_type: string | null;
  duration_ms: number;
  /** Source label only; never raw tool arguments or tool output text. */
  source: string;
}

export interface DiagnosisTrace {
  retrievalCount: number;
  aiAttempts: number;
  aiSuccesses: number;
  aiProvider: 'gemini' | 'deepseek' | 'openai' | null;
  scoreMethod: 'keyword-weighted-overlap';
  contextChars: number;
  sentKnowledgeIds: string[];
  timings: { retrievalMs: number; decisionMs: number; externalAiMs: number; totalMs: number };
  /**
   * Main tool loop observability. Present whenever the diagnosis service runs,
   * even when the loop is disabled or never ran: enabled says whether
   * AGENT_LOOP=main was on, ran says whether the loop actually executed,
   * status is null when it never ran, toolSteps counts desensitised tool
   * events (not model steps), and toolEvents carry no arguments or output.
   */
  mainLoop?: {
    enabled: boolean;
    ran: boolean;
    status: 'answered' | 'question' | 'fallback' | 'cancelled' | null;
    /** Desensitised fallback/cancel reason from the runner (null otherwise). Added so a high fallback share can be diagnosed from logs instead of guessed: without it, production traces only showed the status count. */
    reason: string | null;
    toolSteps: number;
    toolEvents: MainLoopToolEvent[];
  };
}

export interface LlmHealth {
  allowExternalAi?: boolean;
  defaultMode?: DiagnosisMode;
  configured: boolean;
  primary: 'gemini' | 'deepseek' | 'openai' | null;
}
