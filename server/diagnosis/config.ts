/** Small bounded settings; invalid values fall back to documented conservative defaults. */
export interface DiagnosticRuntimeConfig {
  topK: number;
  contextMaxChars: number;
  logDecisions: boolean;
  /**
   * Tool loop mode. 'shadow' runs the tool loop only after the ordinary
   * answer is final, in the background, and never changes the answer.
   * 'main' runs the same bounded read-only loop awaited, before the single
   * LLM call, and may replace the AI supplement (see
   * server/diagnosis/main-loop.md). 'main' and 'shadow' never run together:
   * the service only starts shadow when agentLoop === 'shadow' and only
   * attempts the main loop when agentLoop === 'main'. Anything else
   * (including the browser preview, which has no process.env) is 'off'.
   */
  agentLoop: 'off' | 'shadow' | 'main';
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function diagnosticRuntimeConfig(): DiagnosticRuntimeConfig {
  const env = typeof process === 'undefined' ? {} : process.env;
  const agentLoopValue = env.AGENT_LOOP?.trim().toLowerCase();
  return {
    topK: boundedInteger(env.DIAGNOSIS_TOP_K, 5, 1, 20),
    contextMaxChars: boundedInteger(env.DIAGNOSIS_CONTEXT_MAX_CHARS, 8000, 1000, 32000),
    logDecisions: typeof process !== 'undefined' && env.DIAGNOSIS_LOG_DECISIONS?.trim() !== 'false',
    agentLoop: agentLoopValue === 'shadow' ? 'shadow' : agentLoopValue === 'main' ? 'main' : 'off',
  };
}
