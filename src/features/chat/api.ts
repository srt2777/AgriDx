import type { MemorySession } from '../../../shared/memory';
import { isDiagnosisMode } from '../../../shared/diagnosis';
import type { ChatRequest, LlmHealth } from '../../../shared/chat';
import { ApiError, isRecord, requestJson, type FetchImplementation } from '../../lib/api-client';
import { isAnswerMode, isChatProvider, isFallbackReason, isKnowledgeChunkCount, parseChatMetadata, type ChatMessage } from './session';

export type ChatReply = Omit<ChatMessage, 'id'> & { memory?: MemorySession };

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
