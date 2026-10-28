/** Public protocol contains execution status, never hidden model reasoning or credentials. */
export interface AgentWorkflowInput {
  query: string;
  machine: { brand?: string; model?: string; engineModel?: string };
  faultCode?: string;
}
export interface AgentCitation {
  chunk_id: string; doc_title: string; section_path: string; page: string | null; version: string | null;
  model_match: 'exact'; score: number; snippet: string; source_id: string; scope_boundary: string | null;
}
export interface WorkflowEvent {
  type: 'plan_update' | 'tool_start' | 'tool_end' | 'tool_error' | 'done'; step: number;
  tool?: string; call_id?: string; status?: string; latency_ms?: number; error_code?: string;
}
export interface WorkflowResult {
  status: 'references_found' | 'needs_clarification' | 'insufficient_evidence' | 'refused' | 'degraded';
  content: string; safety: string[]; confidence: '低'; evidence_level: '不足' | '部分';
  citations: AgentCitation[]; questions: { id: string; label: string; options?: string[] }[];
  trace: { id: string; provider: 'local-rule'; prompt_version: string; stop_reason: string; steps: number; elapsed_ms: number; events: WorkflowEvent[] };
}
