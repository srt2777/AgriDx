import type { AnswerMode, ChatProvider, ChatRequest, FallbackReason, MachineContext } from '../../../../shared/chat';
import { isRecord } from '../../lib/api-client';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error' | 'loading';
  content: string;
  model?: string;
  provider?: ChatProvider;
  answerMode?: AnswerMode;
  fallbackReason?: FallbackReason;
  knowledgeChunks?: number;
  localSummary?: string;
  coordinationMessage?: string;
}

export interface ChatSession {
  messages: ChatMessage[];
  context: MachineContext;
  draft: string;
}

export const STORAGE_KEY = '__app_srt27_chat_history';
export const META_KEY = '__app_srt27_chat_meta';
export const MAX_QUESTION_LENGTH = 2000;
export const MACHINE_TYPES_ZH = ['拖拉机', '联合收割机', '插秧机', '植保机', '新能源农机', '无人农机', '其他'];
export const MACHINE_TYPES_EN = ['Tractor', 'Combine', 'Transplanter', 'Sprayer', 'New-energy', 'Autonomous', 'Other'];
type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function isChatProvider(value: unknown): value is ChatProvider {
  return value === 'gemini' || value === 'deepseek' || value === 'knowledge-base';
}

export function isAnswerMode(value: unknown): value is AnswerMode {
  return value === 'knowledge-grounded' || value === 'general-guidance' || value === 'local-evidence';
}

export function isFallbackReason(value: unknown): value is FallbackReason {
  return value === 'not_configured' || value === 'provider_unavailable';
}

export function isKnowledgeChunkCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function parseHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message) => isRecord(message) && typeof message.id === 'string' &&
    typeof message.content === 'string' && (message.role === 'user' || message.role === 'assistant'))
    .slice(-100).map((message) => ({
      id: message.id as string,
      role: message.role as 'user' | 'assistant',
      content: message.content as string,
      localSummary: typeof message.localSummary === 'string' && message.localSummary.length <= 4000 ? message.localSummary : undefined,
      coordinationMessage: typeof message.coordinationMessage === 'string' && message.coordinationMessage.length <= 500 ? message.coordinationMessage : undefined,
      model: typeof message.model === 'string' ? message.model : undefined,
      provider: isChatProvider(message.provider) ? message.provider : undefined,
      answerMode: isAnswerMode(message.answerMode) ? message.answerMode : undefined,
      fallbackReason: isFallbackReason(message.fallbackReason) ? message.fallbackReason : undefined,
      knowledgeChunks: isKnowledgeChunkCount(message.knowledgeChunks) ? message.knowledgeChunks : undefined,
    }));
}

export function parseMachineContext(value: unknown): MachineContext {
  const context = isRecord(value) ? value : {};
  const type = typeof context.machineType === 'string' ? context.machineType : '';
  // Previously saved English labels must still match the Chinese option values.
  const machineType = MACHINE_TYPES_ZH[MACHINE_TYPES_EN.indexOf(type)] || type;
  return {
    machineType: MACHINE_TYPES_ZH.includes(machineType) ? machineType : '',
    brand: typeof context.brand === 'string' ? context.brand.slice(0, 100) : '',
    model: typeof context.model === 'string' ? context.model.slice(0, 100) : '',
  };
}

function readStored(key: string, storage?: SessionStorage): unknown {
  try {
    const saved = (storage ?? localStorage).getItem(key);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function loadChatSession(handoff: unknown, storage?: SessionStorage): ChatSession {
  const context = parseMachineContext(readStored(META_KEY, storage));
  const imported = isRecord(handoff) ? handoff : {};
  // Navigation supplies a draft only; it never sends a diagnostic request itself.
  const suppliedContext = parseMachineContext(imported);
  return {
    messages: parseHistory(readStored(STORAGE_KEY, storage)),
    context: {
      machineType: typeof imported.machineType === 'string' ? suppliedContext.machineType : context.machineType,
      brand: typeof imported.brand === 'string' ? suppliedContext.brand : context.brand,
      model: typeof imported.model === 'string' ? suppliedContext.model : context.model,
    },
    draft: typeof imported.question === 'string' ? imported.question.slice(0, MAX_QUESTION_LENGTH) : '',
  };
}

export function saveHistory(messages: ChatMessage[], storage?: SessionStorage): void {
  try {
    const target = storage ?? localStorage;
    const history = parseHistory(messages);
    if (history.length) target.setItem(STORAGE_KEY, JSON.stringify(history));
    else target.removeItem(STORAGE_KEY);
  } catch { /* Storage may be disabled or full; active chat remains available. */ }
}

export function saveMachineContext(context: MachineContext, storage?: SessionStorage): void {
  try {
    (storage ?? localStorage).setItem(META_KEY, JSON.stringify(context));
  } catch { /* Active chat does not depend on browser storage. */ }
}

export function createChatRequest(messages: ChatMessage[], question: string, context: MachineContext, historyLimit = 20): ChatRequest {
  return {
    messages: [...parseHistory(messages).slice(-Math.min(38, Math.max(0, historyLimit))).map(({ role, content }) => ({
      role: role as 'user' | 'assistant', content,
    })), { role: 'user', content: question }],
    machineType: context.machineType || undefined,
    brand: context.brand || undefined,
    model: context.model || undefined,
  };
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
