import { recentMessages } from '../../server/memory/context';
import { ProviderError, type ChatMessage, type ProviderName } from '../../server/llm/types';
import type { DiagnosticProvider } from '../../server/diagnosis/service';

export interface PreviewAiStatus { enabled: boolean; provider: ProviderName | null; model: string | null }
const disabled: PreviewAiStatus = { enabled: false, provider: null, model: null };
let cached: { expiresAt: number; status: PreviewAiStatus } | undefined;
const isProvider = (value: unknown): value is ProviderName => value === 'deepseek' || value === 'gemini' || value === 'openai';
export async function readPreviewAiStatus(signal?: AbortSignal): Promise<PreviewAiStatus> {
  if (typeof window === 'undefined') return disabled;
  if (cached && cached.expiresAt > Date.now()) return cached.status;
  try {
    const response = await fetch('/api/dev-ai/status', { cache: 'no-store', credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (typeof data.enabled !== 'boolean' || (data.enabled && (!isProvider(data.provider) || typeof data.model !== 'string'))) throw new Error('Invalid AI status');
    const status = data.enabled ? { enabled: true, provider: data.provider, model: data.model } : disabled;
    cached = { expiresAt: Date.now() + 10_000, status };
    return status;
  } catch { signal?.throwIfAborted(); return disabled; }
}
/** The same origin holds the credentials; the browser sends no provider URL or API key. */
export function previewAiProvider(status: PreviewAiStatus, signal?: AbortSignal): DiagnosticProvider {
  return {
    hasAnyConfigured: () => status.enabled,
    async chat(messages: ChatMessage[]) {
      const provider = status.provider || 'deepseek';
      try {
        const system = messages[0]?.role === 'system' ? messages[0] : undefined;
        const recent = recentMessages(messages.filter((item): item is ChatMessage & { role: 'user' | 'assistant' } => item.role === 'user' || item.role === 'assistant'));
        while (recent.length > 1 && recent.reduce((sum, item) => sum + item.content.length, system?.content.length || 0) > 18_000) recent.shift();
        const response = await fetch('/api/dev-ai/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [...(system ? [system] : []), ...recent] }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(23_000)]) : AbortSignal.timeout(23_000) });
        if (!response.ok) {
          await response.body?.cancel();
          throw new ProviderError(provider, response.status === 429 ? 'rate_limit' : response.status === 401 || response.status === 403 ? 'auth' : 'server_error');
        }
        const result = await response.json();
        if (!isProvider(result.provider) || typeof result.content !== 'string' || !result.content.trim() || result.content.length > 24_000 || typeof result.model !== 'string' || result.model.length > 120) throw new ProviderError(provider, 'invalid_response');
        return { result: { provider: result.provider, content: result.content, model: result.model }, primary: result.provider, fellBack: false, attempts: 1 };
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(provider, error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
      }
    },
  };
}
