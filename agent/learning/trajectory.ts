import type { PlannerTopic } from '../../server/diagnosis/plannerPlans';

/**
 * Diagnosis trajectory recording (CMU 11-768 Lecture 8, checklist item 1).
 *
 * A trajectory is the whole of one diagnosis turn, in one fixed shape:
 * user question -> Planner topic -> tool calls -> tool outputs (offline
 * only) -> final answer -> outcome. It is the raw material for the reward
 * scorer (reward.ts) and the SFT exporter (sft.ts).
 *
 * Honesty rules built into this module:
 * - Usage the service does not measure (token counts, cost) is recorded as
 *   null, never invented. The live service has no token/cost meter, so
 *   live trajectories always carry nulls here.
 * - Correctness is 'unknown' for live trajectories. Only an offline caller
 *   that actually knows the expected answer may label a trajectory
 *   'correct' / 'incorrect'.
 * - Text is redacted before it is stored: API-key-like strings, bearer
 *   tokens, e-mail addresses and phone-like numbers are replaced. The
 *   fault text itself is kept, because without it the trajectory is
 *   useless for learning.
 * - This module never writes to disk and never sends anything anywhere.
 *   Persistence is the host's job, via the `onTrajectory` callback on the
 *   diagnosis service (see server/diagnosis/service.ts). The only file
 *   sink in this PR is the offline, opt-in helper in fileSink.ts.
 */

export type TrajectoryOutcome = 'answered' | 'question' | 'local' | 'fallback';

export interface TrajectoryToolCall {
  step: number;
  tool: string;
  ok: boolean;
  errorType: string | null;
  /** Milliseconds when measured, otherwise null. Never estimated. */
  durationMs: number | null;
  source: string;
  /** Evidence IDs this call is associated with, if any. */
  evidenceIds: string[];
}

export interface TrajectoryToolOutput {
  tool: string;
  /** Redacted, truncated tool output text. Live service runs never fill
   *  this in: the main-loop trace is desensitised by design, so live
   *  trajectories carry an empty list here. Only offline fixtures may
   *  supply it (the reward scorer needs it for the numeric-citation check). */
  text: string;
}

export interface TrajectoryUsage {
  /** Tool-loop steps actually run (0 when the tool loop did not run). */
  rounds: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
}

export type TrajectorySource =
  | 'live-diagnosis'
  | 'synthetic-from-existing-cases'
  | 'test-fixture';

export interface DiagnosticTrajectory {
  id: string;
  createdAt: string;
  source: TrajectorySource;
  /** Redacted user question (the current turn's question). */
  question: string;
  machine?: { machineType?: string; brand?: string; model?: string };
  /** Planner topic the turn resolved to, or null when none matched. */
  plannerTopic: PlannerTopic | null;
  /** True when the Planner actually ran for this turn (session-seeded
   *  planner). False when the turn had no planner state at all. */
  plannerUsed: boolean;
  toolCalls: TrajectoryToolCall[];
  toolOutputs: TrajectoryToolOutput[];
  evidenceIds: string[];
  /** Redacted final user-visible answer. */
  answer: string;
  outcome: TrajectoryOutcome;
  route: string;
  reason: string;
  usage: TrajectoryUsage;
  correctness: 'unknown' | 'correct' | 'incorrect';
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /(?<!\d)1[3-9]\d{9}(?!\d)/g,
  /[0-9a-f]{32,}/gi,
];

/** Redact secrets / contact-like strings from trajectory text. */
export function redactTrajectoryText(value: string): string {
  if (typeof value !== 'string') return '';
  let out = value;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[已脱敏]');
  return out;
}

export interface BuildTrajectoryInput {
  id?: string;
  createdAt?: string;
  source?: TrajectorySource;
  question: string;
  machine?: { machineType?: string; brand?: string; model?: string };
  plannerTopic?: PlannerTopic | null;
  plannerUsed?: boolean;
  toolCalls?: TrajectoryToolCall[];
  toolOutputs?: TrajectoryToolOutput[];
  evidenceIds?: string[];
  answer: string;
  outcome?: TrajectoryOutcome;
  route?: string;
  reason?: string;
  usage?: Partial<TrajectoryUsage>;
  correctness?: 'unknown' | 'correct' | 'incorrect';
}

const MAX_TEXT_CHARS = 16000;
const MAX_TOOL_OUTPUT_CHARS = 2000;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…（已截断）` : value;
}

export function buildDiagnosticTrajectory(input: BuildTrajectoryInput): DiagnosticTrajectory {
  const toolOutputs = (input.toolOutputs ?? []).map(output => ({
    tool: output.tool,
    text: truncate(redactTrajectoryText(output.text), MAX_TOOL_OUTPUT_CHARS),
  }));
  return {
    id: input.id ?? `traj-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    source: input.source ?? 'live-diagnosis',
    question: truncate(redactTrajectoryText(input.question), MAX_TEXT_CHARS),
    ...(input.machine ? { machine: { ...input.machine } } : {}),
    plannerTopic: input.plannerTopic ?? null,
    plannerUsed: input.plannerUsed ?? false,
    toolCalls: (input.toolCalls ?? []).map(call => ({ ...call })),
    toolOutputs,
    evidenceIds: [...(input.evidenceIds ?? [])],
    answer: truncate(redactTrajectoryText(input.answer), MAX_TEXT_CHARS),
    outcome: input.outcome ?? 'answered',
    route: input.route ?? '',
    reason: input.reason ?? '',
    usage: {
      rounds: input.usage?.rounds ?? 0,
      promptTokens: input.usage?.promptTokens ?? null,
      completionTokens: input.usage?.completionTokens ?? null,
      totalTokens: input.usage?.totalTokens ?? null,
      costUsd: input.usage?.costUsd ?? null,
    },
    correctness: input.correctness ?? 'unknown',
  };
}
