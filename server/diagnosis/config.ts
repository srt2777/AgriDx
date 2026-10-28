/** Small bounded settings; invalid values fall back to documented conservative defaults. */
export interface DiagnosticRuntimeConfig {
  topK: number;
  contextMaxChars: number;
  logDecisions: boolean;
  /** Experimental shadow tool loop; anything other than `shadow` (including the browser preview) is off. */
  agentLoop: 'off' | 'shadow';
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function diagnosticRuntimeConfig(): DiagnosticRuntimeConfig {
  const env = typeof process === 'undefined' ? {} : process.env;
  return {
    topK: boundedInteger(env.DIAGNOSIS_TOP_K, 5, 1, 20),
    contextMaxChars: boundedInteger(env.DIAGNOSIS_CONTEXT_MAX_CHARS, 8000, 1000, 32000),
    logDecisions: typeof process !== 'undefined' && env.DIAGNOSIS_LOG_DECISIONS?.trim() !== 'false',
    agentLoop: env.AGENT_LOOP?.trim().toLowerCase() === 'shadow' ? 'shadow' : 'off',
  };
}
