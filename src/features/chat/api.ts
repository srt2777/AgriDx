import type { MemorySession } from '../../../shared/memory';
import { isDiagnosisMode } from '../../../shared/diagnosis';
import type { ChatRequest, LlmHealth } from '../../../shared/chat';
import { ApiError, isRecord, requestJson, type FetchImplementation } from '../../lib/api-client';
import { isAnswerMode, isChatProvider, isFallbackReason, isKnowledgeChunkCount, parseChatMetadata, type ChatMessage } from './session';

export type ChatReply = Omit<ChatMessage, 'id'> & { memory?: MemorySession; memorySaveFailed?: boolean };

export function parseChatResponse(value: unknown): ChatReply {
  if (!isRecord(value) || !Array.isArray(value.choices)) throw new Error('Invalid chat response');
  const choice: unknown = value.choices[0];
  const message = isRecord(choice) ? choice.message : undefined;
  if (!isRecord(message) || typeof message.content !== 'string' || !message.content.trim()) {
    throw new Error('Empty chat response');
  }
  return {
    ...parseChatMetadata(value),
    role: 'assistant',
    localSummary: value.provider === 'knowledge-base' && typeof value.localSummary === 'string' && value.localSummary.length <= 4000 ? value.localSummary : undefined,
    coordinationMessage: typeof value.coordinationMessage === 'string' && value.coordinationMessage.length <= 500 ? value.coordinationMessage : undefined,
    memory: isRecord(value.memory) && typeof value.memory.id === 'string' && Number.isSafeInteger(value.memory.revision) && typeof value.memory.deviceId === 'string' ? value.memory as unknown as MemorySession : undefined,
    memorySaveFailed: value.memorySaveFailed === true ? true : undefined,
    content: message.content,
    model: typeof value.model === 'string' ? value.model : undefined,
    provider: isChatProvider(value.provider) ? value.provider : undefined,
    answerMode: isAnswerMode(value.answerMode) ? value.answerMode : undefined,
    fallbackReason: isFallbackReason(value.fallbackReason) ? value.fallbackReason : undefined,
    knowledgeChunks: isKnowledgeChunkCount(value.knowledgeChunks) ? value.knowledgeChunks : undefined,
  };
}

export async function requestChat(
  request: ChatRequest,
  signal: AbortSignal,
  unavailableMessage: string,
  fetchImplementation?: FetchImplementation,
): Promise<ChatReply> {
  try {
    return parseChatResponse(await requestJson('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    }, fetchImplementation));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const payload = error.payload;
    // Server messages are already sanitized; malformed error bodies use the localized fallback.
    const content = isRecord(payload) && typeof payload.error === 'string' && payload.error
      ? payload.error : unavailableMessage;
    return { role: 'error', content };
  }
}

/**
 * Streaming variant of requestChat: POSTs with `Accept: text/event-stream`
 * and calls onDelta for each `delta` event (the AI supplement as it is
 * generated, before the answer guard runs — a provisional preview).
 * The `done` event carries the same envelope parseChatResponse expects;
 * it is authoritative and replaces the preview. If the server answers
 * with plain JSON instead (for example a preview gateway without SSE),
 * the JSON reply is returned directly and onDelta is never called.
 * An `error` event becomes the same error reply requestChat returns for
 * an HTTP error. Transport aborts and timeouts still throw, so the
 * caller's failure classification is unchanged.
 */
export async function requestChatStream(
  request: ChatRequest,
  signal: AbortSignal,
  unavailableMessage: string,
  onDelta: (text: string) => void,
  fetchImplementation?: FetchImplementation,
): Promise<ChatReply> {
  try {
    signal.throwIfAborted();
    const requestOptions: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(request),
      signal,
    };
    const response = typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__ && fetchImplementation === fetch
      ? await (await import('../../dev-preview/api')).previewFetch('/api/chat', requestOptions)
      : await (fetchImplementation ?? fetch)('/api/chat', requestOptions);
    signal.throwIfAborted();
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      signal.throwIfAborted();
      throw new ApiError(response.status, payload);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return parseChatResponse(await response.json());
    }
    if (!response.body) throw new Error('Invalid chat response');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let event = '';
    let data = '';
    let result: ChatReply | null = null;
    const dispatch = () => {
      if (!event || result) return;
      let parsed: unknown = null;
      try { parsed = JSON.parse(data); } catch { return; }
      if (event === 'delta') {
        if (isRecord(parsed) && typeof parsed.text === 'string' && parsed.text) onDelta(parsed.text);
      } else if (event === 'done') {
        result = parseChatResponse(parsed);
      } else if (event === 'error') {
        const content = isRecord(parsed) && typeof parsed.error === 'string' && parsed.error
          ? parsed.error : unavailableMessage;
        result = { role: 'error', content };
      }
      event = '';
      data = '';
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line === '') dispatch();
        else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).replace(/^ /, '');
        newline = buffer.indexOf('\n');
      }
      if (done) break;
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        const trimmed = line.replace(/\r$/, '');
        if (trimmed === '') dispatch();
        else if (trimmed.startsWith('event:')) event = trimmed.slice(6).trim();
        else if (trimmed.startsWith('data:')) data += (data ? '\n' : '') + trimmed.slice(5).replace(/^ /, '');
      }
      dispatch();
    }
    signal.throwIfAborted();
    if (!result) throw new Error('Invalid chat response');
    return result;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const payload = error.payload;
    const content = isRecord(payload) && typeof payload.error === 'string' && payload.error
      ? payload.error : unavailableMessage;
    return { role: 'error', content };
  }
}

export function parseLlmHealth(value: unknown): LlmHealth {
  const llm = isRecord(value) ? value.llm : undefined;
  if (!isRecord(llm) || typeof llm.configured !== 'boolean') throw new Error('Unknown LLM configuration');
  const coordination = isRecord(value) && isRecord(value.coordination) ? value.coordination : {};
  return {
    ...(typeof coordination.allowExternalAi === 'boolean' ? { allowExternalAi: coordination.allowExternalAi } : {}),
    ...(isDiagnosisMode(coordination.defaultMode) ? { defaultMode: coordination.defaultMode } : {}),
    configured: llm.configured,
    primary: llm.primary === 'gemini' || llm.primary === 'deepseek' || llm.primary === 'openai' ? llm.primary : null,
  };
}

export async function requestLlmHealth(signal: AbortSignal): Promise<LlmHealth> {
  return parseLlmHealth(await requestJson('/api/health', { signal }));
}
