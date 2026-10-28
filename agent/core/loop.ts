import { Registry, type ToolResponse } from '../runtime/registry';

export interface ToolCall { id: string; name: string; args: unknown }
export interface ToolObservation { call: ToolCall; result: ToolResponse }
export interface AgentProvider {
  readonly name: string;
  next(context: { observations: readonly ToolObservation[]; step: number; signal: AbortSignal }): Promise<{ calls: ToolCall[] } | { done: true }>;
}
export type AgentEvent = { type: 'plan_update' | 'tool_start' | 'tool_end' | 'tool_error' | 'done'; step: number; tool?: string; call_id?: string; status?: string; latency_ms?: number; error_code?: string };
export interface LoopOutcome { reason: 'complete' | 'cancelled' | 'timeout' | 'step_budget' | 'call_budget' | 'context_budget' | 'no_progress' | 'repeated_call' | 'provider_error'; observations: ToolObservation[]; steps: number }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable((value as Record<string, unknown>)[key]))])));
  return JSON.stringify(value) ?? 'null';
}
/** No private model reasoning is emitted. All tools here are read-only; writes require a separate trusted host. */
export async function runLoop(registry: Registry, provider: AgentProvider, options: {
  signal?: AbortSignal; maxSteps?: number; timeoutMs?: number; concurrency?: number; maxCalls?: number; maxContextChars?: number;
  onEvent?: (event: AgentEvent) => void;
} = {}): Promise<LoopOutcome> {
  const maxSteps = options.maxSteps ?? 8, maxCalls = options.maxCalls ?? 16, timeoutMs = options.timeoutMs ?? 60_000;
  const concurrency = options.concurrency ?? 3, maxContextChars = options.maxContextChars ?? 64_000;
  if (![maxSteps, maxCalls, timeoutMs, concurrency, maxContextChars].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('循环预算必须为正整数');
  const controller = new AbortController(); let timedOut = false; let rejectAbort: () => void = () => {};
  const abort = () => { rejectAbort(); controller.abort(); };
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error('aborted')); });
  // A task can cancel before its provider is first awaited.
  interrupted.catch(() => {});
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  options.signal?.addEventListener('abort', abort, { once: true });
  const observations: ToolObservation[] = []; const repeats = new Map<string, number>(); const ids = new Set<string>();
  let steps = 0, noProgress = 0; const seenEvidence = new Set<string>();
  const emit = (event: AgentEvent) => { try { options.onEvent?.(event); } catch { /* A disconnected viewer must not affect execution. */ } };
  const finish = (reason: LoopOutcome['reason']): LoopOutcome => { emit({ type: 'done', step: steps, status: reason }); return { reason, observations, steps }; };
  try {
    if (options.signal?.aborted) return finish('cancelled');
    for (let step = 0; step < maxSteps; step++) {
      steps = step + 1;
      if (controller.signal.aborted) return finish(timedOut ? 'timeout' : 'cancelled');
      if (stable(observations).length > maxContextChars) return finish('context_budget');
      emit({ type: 'plan_update', step: steps, status: 'selecting_tools' });
      const next = await Promise.race([provider.next({ observations: structuredClone(observations), step, signal: controller.signal }), interrupted]);
      if ('done' in next) return finish('complete');
      if (!Array.isArray(next.calls) || !next.calls.length) return finish('no_progress');
      if (observations.length + next.calls.length > maxCalls) return finish('call_budget');
      for (const call of next.calls) {
        if (!call || typeof call.name !== 'string' || typeof call.id !== 'string' || !call.id || ids.has(call.id)) return finish('provider_error');
        ids.add(call.id);
        const key = stable([call.name, call.args]); const count = (repeats.get(key) ?? 0) + 1; repeats.set(key, count);
        if (count > 2) return finish('repeated_call');
      }
      const batch: ToolObservation[] = new Array(next.calls.length); let index = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, next.calls.length) }, async () => {
        while (index < next.calls.length && !controller.signal.aborted) {
          const slot = index++; const call = next.calls[slot]; emit({ type: 'tool_start', step: steps, tool: call.name, call_id: call.id });
          const result = await registry.execute(call.name, call.args, { allowed: ['read'], signal: controller.signal, cacheScope: 'current-task' });
          batch[slot] = { call, result };
          emit({ type: result.ok ? 'tool_end' : 'tool_error', step: steps, tool: call.name, call_id: call.id, latency_ms: result.meta.latency_ms, ...(result.error ? { error_code: result.error.code } : {}) });
        }
      }));
      const completed = batch.filter(Boolean); observations.push(...completed);
      if (controller.signal.aborted) return finish(timedOut ? 'timeout' : 'cancelled');
      let progress = false;
      for (const observation of completed) {
        if (!observation.result.ok) continue;
        // Compare actual returned data, excluding latency and call IDs. Repeated cached data is not progress.
        const key = stable(observation.result.data);
        if (!seenEvidence.has(key)) { seenEvidence.add(key); progress = true; }
      }
      noProgress = progress ? 0 : noProgress + 1;
      if (noProgress >= 2) return finish('no_progress');
    }
    return finish('step_budget');
  } catch { return finish(controller.signal.aborted ? timedOut ? 'timeout' : 'cancelled' : 'provider_error'); }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
