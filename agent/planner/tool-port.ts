import type { ToolExecutor } from '../tool-executor';
import type { ToolRegistry } from '../tool-registry';
import type { ToolResult } from '../tool-types';

/** Trusted host binding, never supplied by a model or HTTP body. */
export interface PlannerToolLease {
  episodeId: string;
  scopeKey: string;
  planVersion: number;
  revision: number;
}
export const PLANNER_READ_TOOLS = ['resolve_machine_scope', 'get_knowledge_entry'] as const;
export type PlannerReadTool = typeof PLANNER_READ_TOOLS[number];
export interface PlannerToolObservation {
  callId: string;
  stepId: string;
  lease: PlannerToolLease;
  source: 'tool_result';
  verification: 'unverified';
  outcome: 'success' | 'failure' | 'timeout' | 'cancelled' | 'stale' | 'empty';
  result?: ToolResult;
}

/** A bounded adapter around the existing executor. Does not persist or dispatch repairs.
 * Host must retain one instance per task and atomically CAS the returned lease.
 * The explicit allowlist is necessary because executor defaults are broader.
 */
export class PlannerToolPort {
  private readonly calls = new Set<string>();
  constructor(private readonly executor: Pick<ToolExecutor, 'execute'>, private readonly registry: Pick<ToolRegistry, 'get'>) {}
  async execute(input: {
    callId: string; stepId: string; tool: PlannerReadTool; args: Record<string, unknown>;
    lease: PlannerToolLease; signal?: AbortSignal; timeoutMs?: number;
    isCurrent: (lease: PlannerToolLease) => boolean;
  }): Promise<PlannerToolObservation> {
    const lease = structuredClone(input.lease);
    const base = { callId: input.callId, stepId: input.stepId, lease, source: 'tool_result' as const, verification: 'unverified' as const };
    if (!input.isCurrent(lease)) return { ...base, outcome: 'stale' };
    if (input.signal?.aborted) return { ...base, outcome: 'cancelled' };
    if (!PLANNER_READ_TOOLS.includes(input.tool) || this.registry.get(input.tool)?.risk !== 'read') throw new TypeError('Planner tool is not explicitly authorized read-only');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,100}$/.test(input.callId) || input.callId.startsWith('planner:') || !input.stepId || input.stepId.length > 400 || this.calls.has(input.callId) || this.calls.size >= 2) throw new TypeError('Planner tool call budget exhausted or duplicate');
    const timeoutMs = input.timeoutMs ?? 1000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) throw new TypeError('Invalid Planner tool deadline');
    this.calls.add(input.callId);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort!: () => void;
    const stopped = new Promise<ToolResult>(resolve => {
      const stop = (type: 'TIMEOUT' | 'CANCELLED') => {
        controller.abort();
        resolve({ ok: false, content: '', error_type: type, duration_ms: 0 });
      };
      abort = () => stop('CANCELLED');
      input.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
      if (input.signal?.aborted) abort();
    });
    let result: ToolResult;
    try {
      result = await Promise.race([
        stopped,
        Promise.resolve().then(() => controller.signal.aborted
          ? { ok: false, content: '', error_type: 'CANCELLED' as const, duration_ms: 0 }
          : this.executor.execute(input.tool, structuredClone(input.args), { signal: controller.signal }))
          .catch(() => ({ ok: false, content: '', error_type: 'TOOL_ERROR' as const, duration_ms: 0 })),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
    }
    if (!input.isCurrent(lease)) return { ...base, outcome: 'stale' };
    if (input.signal?.aborted) return { ...base, outcome: 'cancelled' };
    let empty = !result.content.trim();
    if (result.ok && input.tool === 'get_knowledge_entry') {
      try {
        const parsed: unknown = JSON.parse(result.content);
        empty ||= Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'error' in parsed);
      } catch { /* The host must validate any tool data before using it as evidence. */ }
    }
    return { ...base, result, outcome: result.ok ? empty ? 'empty' : 'success' : result.error_type === 'TIMEOUT' ? 'timeout' : result.error_type === 'CANCELLED' ? 'cancelled' : 'failure' };
  }
}

/** Convert an accepted tool outcome to a bounded event; raw tool content is not a repair fact. */
export function plannerToolEvent(observation: PlannerToolObservation, stepKey: string): import('./types').PlannerEvent {
  if (observation.outcome === 'stale') throw new TypeError('Stale tool results cannot enter a plan');
  const provenance: import('./types').ToolProvenance = {};
  if (observation.outcome === 'success' && observation.result?.content) {
    try {
      const value: unknown = JSON.parse(observation.result.content);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const fields = value as Record<string, unknown>;
        for (const [source, target] of [['sourceId', 'sourceId'], ['entryId', 'entryId'], ['status', 'sourceStatus']] as const) {
          const field = fields[source];
          if (typeof field === 'string' && field.trim() && field.length <= 120 && ![...field].some(char => char.charCodeAt(0) < 32)) provenance[target] = field;
        }
      }
    } catch { /* No unverified text is invented as provenance. */ }
  }
  return { type: 'tool_finished', id: `result:${observation.callId}`, episodeId: observation.lease.episodeId,
    stepKey, callId: observation.callId, outcome: observation.outcome,
    value: observation.outcome === 'success' ? 'available' : null, ...(Object.keys(provenance).length ? { provenance } : {}) };
}
