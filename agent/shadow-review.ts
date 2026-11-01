/**
 * Shadow review records: review-only, never part of a diagnosis answer.
 *
 * A shadow run is an experimental, bounded, read-only loop. Its output must
 * not be written to the diagnosis memory in `server/memory/store.ts`, must
 * not be spliced into a user-facing answer, and must not be treated as
 * verified repair evidence. This module is the only place that turns a
 * shadow run into a review record: it keeps the record in a separate,
 * in-memory store, classifies the comparison against the main rule path
 * into exactly four categories, and leaves promotion to a human reviewer.
 * No persistence, no network, no clock reads, no telemetry data.
 */

export type ShadowReviewComparison = 'consistent' | 'new_evidence' | 'conflict' | 'high_risk';

export interface ShadowReviewToolResult {
  tool: string;
  ok: boolean;
  error_type: string | null;
  duration_ms: number;
  source: string;
}

export interface ShadowReviewRecord {
  /** Diagnosis session the shadow run was triggered from; never a device id. */
  sessionId: string;
  /** Evidence ids the main rule path had at trigger time. */
  evidenceIds: readonly string[];
  /** Evidence ids the shadow run surfaced, if any; empty is honest, not a guess. */
  shadowEvidenceIds: readonly string[];
  /** Planner / tool step sequence, e.g. "0:resolve_machine_scope". */
  plannerSteps: readonly string[];
  /** Redacted tool results: tool, outcome, duration and source only. */
  toolResults: readonly ShadowReviewToolResult[];
  comparison: ShadowReviewComparison;
  mainRoute: string;
  mainReason?: string;
  durationMs: number;
  timedOut: boolean;
  /** 'high_risk' forces the main rule path; anything else is only a candidate. */
  safety: 'ok' | 'high_risk';
  /** Marker so a consumer can assert this record never entered an answer. */
  reviewOnly: true;
}

export interface ShadowReviewInput {
  sessionId: string;
  mainEvidenceIds: readonly string[];
  shadowEvidenceIds?: readonly string[];
  plannerSteps: readonly string[];
  toolResults: readonly ShadowReviewToolResult[];
  mainRoute: string;
  mainReason?: string;
  durationMs: number;
  timedOut: boolean;
  /** True when the main path already flagged high risk. */
  highRisk: boolean;
  /** True when the shadow run itself found an identity or evidence conflict. */
  conflict?: boolean;
}

const MAX_EVIDENCE_IDS = 64;
const MAX_STEPS = 64;
const MAX_TOOL_RESULTS = 64;

function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some((char) => char.charCodeAt(0) < 32)) {
    throw new TypeError(`Invalid shadow review ${label}`);
  }
  return value;
}

function boundedIds(values: readonly unknown[], label: string): string[] {
  if (!Array.isArray(values) || values.length > MAX_EVIDENCE_IDS) throw new TypeError(`Too many shadow review ${label}`);
  const seen = new Set<string>();
  for (const value of values) {
    const id = boundedText(value, 120, label);
    if (seen.has(id)) throw new TypeError(`Duplicate shadow review ${label}`);
    seen.add(id);
  }
  return [...seen];
}

/**
 * Exactly four outcomes, in precedence order. High risk always wins, so a
 * high-risk record can never be promoted as ordinary new evidence.
 */
export function classifyShadowComparison(input: {
  mainEvidenceIds: readonly string[];
  shadowEvidenceIds: readonly string[];
  highRisk: boolean;
  conflict: boolean;
}): ShadowReviewComparison {
  if (input.highRisk) return 'high_risk';
  if (input.conflict) return 'conflict';
  const main = new Set(input.mainEvidenceIds);
  if (input.shadowEvidenceIds.some((id) => !main.has(id))) return 'new_evidence';
  return 'consistent';
}

export function buildShadowReviewRecord(input: ShadowReviewInput): ShadowReviewRecord {
  const sessionId = boundedText(input.sessionId, 128, 'sessionId');
  const evidenceIds = boundedIds(input.mainEvidenceIds, 'evidenceIds');
  const shadowEvidenceIds = boundedIds(input.shadowEvidenceIds ?? [], 'shadowEvidenceIds');
  if (!Array.isArray(input.plannerSteps) || input.plannerSteps.length > MAX_STEPS) throw new TypeError('Too many shadow review steps');
  const plannerSteps = input.plannerSteps.map((step) => boundedText(step, 200, 'step'));
  if (!Array.isArray(input.toolResults) || input.toolResults.length > MAX_TOOL_RESULTS) throw new TypeError('Too many shadow review tool results');
  const toolResults = input.toolResults.map((result) => {
    if (!result || typeof result !== 'object') throw new TypeError('Invalid shadow review tool result');
    return {
      tool: boundedText(result.tool, 120, 'tool'),
      ok: result.ok === true,
      error_type: result.error_type === null || result.error_type === undefined ? null : boundedText(result.error_type, 120, 'error_type'),
      duration_ms: Number.isFinite(result.duration_ms) && result.duration_ms >= 0 ? Math.round(result.duration_ms) : 0,
      source: boundedText(result.source, 120, 'source'),
    };
  });
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new TypeError('Invalid shadow review duration');
  const comparison = classifyShadowComparison({
    mainEvidenceIds: evidenceIds,
    shadowEvidenceIds,
    highRisk: input.highRisk === true,
    conflict: input.conflict === true,
  });
  return {
    sessionId,
    evidenceIds,
    shadowEvidenceIds,
    plannerSteps,
    toolResults,
    comparison,
    mainRoute: boundedText(input.mainRoute, 120, 'mainRoute'),
    ...(input.mainReason !== undefined ? { mainReason: boundedText(input.mainReason, 200, 'mainReason') } : {}),
    durationMs: Math.round(input.durationMs),
    timedOut: input.timedOut === true,
    safety: comparison === 'high_risk' ? 'high_risk' : 'ok',
    reviewOnly: true,
  };
}

/**
 * In-memory review queue, deliberately separate from MemoryStore.
 * Records are cloned on read so a reviewer cannot mutate a stored record
 * through a returned reference. The queue keeps the newest 100 records;
 * older review records are dropped, never written to diagnosis memory.
 */
export class InMemoryShadowReviewStore {
  private readonly records: ShadowReviewRecord[] = [];
  private static readonly MAX_RECORDS = 100;

  append(record: ShadowReviewRecord): void {
    if (!record || record.reviewOnly !== true) throw new TypeError('Only review-only shadow records can be stored');
    this.records.push(structuredClone(record));
    while (this.records.length > InMemoryShadowReviewStore.MAX_RECORDS) this.records.shift();
  }

  list(sessionId?: string): ShadowReviewRecord[] {
    const selected = sessionId === undefined ? this.records : this.records.filter((record) => record.sessionId === sessionId);
    return selected.map((record) => structuredClone(record));
  }

  /**
   * Promotion candidates only. A record here is still not a rule: the host
   * must separately check that its evidence is verified, has a manual page
   * or scope annotation, is not high risk, and reproduces offline.
   */
  candidatesForPromotion(sessionId?: string): ShadowReviewRecord[] {
    return this.list(sessionId).filter((record) => record.comparison === 'new_evidence');
  }
}
