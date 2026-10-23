import type { AnswerMode, ChatProvider, ChatRequest, ChatResponse, FallbackReason, MachineContext } from '../../../shared/chat';
import type { DiagnosticReply } from '../../../shared/diagnosis';
import { isDiagnosisMode } from '../../../shared/diagnosis';
import { KNOWLEDGE_ROLES } from '../../../shared/knowledge-catalog';
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
  diagnosticReply?: DiagnosticReply;
  knowledgeSources?: ChatResponse['knowledgeSources'];
  coordination?: ChatResponse['coordination'];
  diagnosisTrace?: ChatResponse['diagnosisTrace'];
  roleFlow?: ChatResponse['roleFlow'];
}

/** These are current diagnostic inputs, separate from the saved vehicle profile. */
export interface DiagnosticContext extends MachineContext { engineModel?: string; faultCodes?: string[] }

export interface ChatSession {
  messages: ChatMessage[];
  context: DiagnosticContext;
  draft: string;
}

export const STORAGE_KEY = '__app_srt27_chat_history';
export const META_KEY = '__app_srt27_chat_meta';
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_ATTACHMENT_BYTES = 16_384;
export interface DiagnosticTextAttachment { name: string; text: string }
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

const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
const texts = (value: unknown, max = 20, length = 100): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => text(item, length));
const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T => typeof value === 'string' && options.includes(value as T);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function parseDiagnosticReply(value: unknown): DiagnosticReply | undefined {
  if (!isRecord(value) || !text(value.understanding, 2000) || !value.understanding.trim()
    || !oneOf(value.supportLevel, ['manual', 'general', 'reference_only', 'none']) || !text(value.sourceNote, 2000)
    || !Array.isArray(value.causes) || value.causes.length > 8 || !Array.isArray(value.suggestions) || value.suggestions.length > 12
    || !Array.isArray(value.questions) || value.questions.length > 6) return undefined;
  if (!value.causes.every(cause => isRecord(cause) && text(cause.text) && texts(cause.evidenceIds) && oneOf(cause.basis, ['source_candidate', 'general_hypothesis']))
    || !value.suggestions.every(item => isRecord(item) && text(item.text) && texts(item.evidenceIds) && finite(item.priority) && oneOf(item.kind, ['observe', 'record', 'professional']))
    || !value.questions.every(item => isRecord(item) && text(item.text) && (item.options === undefined || texts(item.options, 8, 300)))) return undefined;
  return {
    understanding: value.understanding, supportLevel: value.supportLevel, sourceNote: value.sourceNote,
    causes: value.causes.map(item => ({ text: item.text, evidenceIds: [...item.evidenceIds], basis: item.basis })),
    suggestions: value.suggestions.map(item => ({ text: item.text, kind: item.kind, evidenceIds: [...item.evidenceIds], priority: item.priority })),
    questions: value.questions.map(item => ({ text: item.text, ...(item.options ? { options: [...item.options] } : {}) })),
    ...(text(value.aiSupplement, 16000) ? { aiSupplement: value.aiSupplement } : {}),
  };
}

/** Keep bounded public response fields; raw server payloads never enter browser history. */
export function parseChatMetadata(value: unknown): Pick<ChatMessage, 'diagnosticReply' | 'knowledgeSources' | 'coordination' | 'diagnosisTrace' | 'roleFlow'> {
  if (!isRecord(value)) return {};
  const result: ReturnType<typeof parseChatMetadata> = {};
  const diagnosticReply = parseDiagnosticReply(value.diagnosticReply);
  if (diagnosticReply) result.diagnosticReply = diagnosticReply;
  if (Array.isArray(value.knowledgeSources) && value.knowledgeSources.length <= 40) {
    result.knowledgeSources = value.knowledgeSources.filter(source => isRecord(source) && text(source.source) && text(source.heading))
      .map(source => {
        const item: ChatResponse['knowledgeSources'][number] = { source: source.source, heading: source.heading };
        for (const field of ['entryId', 'entryType', 'evidenceLabel', 'sourceId', 'locator', 'version', 'status', 'sourceTitle', 'scopeBoundary', 'engineModel'] as const) {
          if (text(source[field])) item[field] = source[field];
        }
        if (source.diagnosticEvidence === false) item.diagnosticEvidence = false;
        if (source.generalEvidence === true) item.generalEvidence = true;
        if (oneOf(source.usage, ['answer-evidence', 'prompt-context', 'reference-only'])) item.usage = source.usage;
        if (texts(source.models, 100, 100)) item.models = [...source.models];
        if (texts(source.faultCodes, 20, 32)) item.faultCodes = [...source.faultCodes];
        if (oneOf(source.evidenceKind, ['archive', 'general-knowledge', 'prompt'])) item.evidenceKind = source.evidenceKind;
        if (oneOf(source.applicability, ['matched', 'pending'])) item.applicability = source.applicability;
        if (oneOf(source.referenceVerification, ['verified', 'pending', 'unverified', 'unspecified', 'failed'])) item.referenceVerification = source.referenceVerification;
        if (typeof source.sourceIndexed === 'boolean') item.sourceIndexed = source.sourceIndexed;
        if (isRecord(source.pages)) item.pages = { ...(text(source.pages.pdf, 100) ? { pdf: source.pages.pdf } : {}), ...(text(source.pages.printed, 100) ? { printed: source.pages.printed } : {}) };
        if (Array.isArray(source.roles)) item.roles = source.roles.filter((role: unknown) => oneOf(role, KNOWLEDGE_ROLES));
        if (oneOf(source.roleBasis, ['原文标记', '人工核对'])) item.roleBasis = source.roleBasis;
        if (oneOf(source.riskLevel, ['high', 'medium', 'low'])) item.riskLevel = source.riskLevel;
        if (isRecord(source.retrieval) && oneOf(source.retrieval.tier, ['exact', 'series', 'component', 'general']) && texts(source.retrieval.basis, 12, 500) && typeof source.retrieval.referenceOnly === 'boolean') {
          item.retrieval = { tier: source.retrieval.tier, basis: [...source.retrieval.basis], referenceOnly: source.retrieval.referenceOnly };
        }
        return item;
      });
  }
  const coordination = value.coordination;
  if (isRecord(coordination) && isDiagnosisMode(coordination.requestedMode) && isDiagnosisMode(coordination.effectiveMode)
    && oneOf(coordination.route, ['local', 'clarify', 'ai', 'safe']) && text(coordination.reason, 100)
    && oneOf(coordination.evidenceLevel, ['none', 'partial', 'direct_reference']) && typeof coordination.llmConfigured === 'boolean') {
    const allowedReasons = ['identity_conflict', 'identity_required', 'server_local_only', 'invalid_config', 'local_requested', 'direct_reference', 'llm_not_configured', 'insufficient_evidence', 'synthesis_requested', 'ai_requested', 'provider_unavailable', 'llm_config_invalid', 'high_risk_insufficient_evidence', 'high_risk_restricted', 'unknown_operation_risk', 'knowledge_conflict', 'output_rejected'] as const;
    if (oneOf(coordination.reason, allowedReasons)) result.coordination = {
      requestedMode: coordination.requestedMode, effectiveMode: coordination.effectiveMode, route: coordination.route,
      reason: coordination.reason, evidenceLevel: coordination.evidenceLevel, llmConfigured: coordination.llmConfigured,
      ...(texts(coordination.knowledgeIds, 40) ? { knowledgeIds: [...coordination.knowledgeIds] } : {}),
      ...(typeof coordination.aiRequired === 'boolean' ? { aiRequired: coordination.aiRequired } : {}),
      ...(oneOf(coordination.riskLevel, ['low', 'high', 'unknown']) ? { riskLevel: coordination.riskLevel } : {}),
      ...(oneOf(coordination.retrievalOutcome, ['no_manual', 'no_results', 'insufficient_evidence', 'sufficient']) ? { retrievalOutcome: coordination.retrievalOutcome } : {}),
      ...(texts(coordination.outputIssues, 20, 300) ? { outputIssues: [...coordination.outputIssues] } : {}),
      ...(texts(coordination.directEligibleIds, 40) ? { directEligibleIds: [...coordination.directEligibleIds] } : {}),
      ...(texts(coordination.referenceOnlyIds, 40) ? { referenceOnlyIds: [...coordination.referenceOnlyIds] } : {}),
      ...(texts(coordination.excludedKnowledgeIds, 40) ? { excludedKnowledgeIds: [...coordination.excludedKnowledgeIds] } : {}),
    };
    if (result.coordination && Array.isArray(coordination.candidates) && coordination.candidates.length <= 40) {
      result.coordination.candidates = coordination.candidates.filter(candidate => isRecord(candidate) && isRecord(candidate.relevance)
        && (candidate.relevance.score === null || finite(candidate.relevance.score)) && oneOf(candidate.relevance.method, ['keyword-weighted-overlap', 'unavailable'])
        && candidate.relevance.calibrated === false && oneOf(candidate.relevance.level, ['high', 'medium', 'low', 'unknown'])
        && isRecord(candidate.coverage) && typeof candidate.coverageSufficient === 'boolean' && oneOf(candidate.modelMatch, ['exact', 'compatible', 'unknown', 'conflict'])
        && oneOf(candidate.referenceVerification, ['verified', 'pending', 'unverified', 'unspecified', 'failed']) && oneOf(candidate.verificationBasis, ['document-review', 'none'])
        && typeof candidate.sourceIndexed === 'boolean' && oneOf(candidate.riskLevel, ['low', 'high', 'unknown']) && typeof candidate.directEligible === 'boolean' && typeof candidate.excluded === 'boolean')
        .map(candidate => ({ ...(text(candidate.entryId, 100) ? { entryId: candidate.entryId } : {}), ...(text(candidate.sourceId, 100) ? { sourceId: candidate.sourceId } : {}),
          relevance: { score: candidate.relevance.score, method: candidate.relevance.method, calibrated: false as const, level: candidate.relevance.level },
          coverage: Object.fromEntries(['symptom', 'causes', 'checks', 'repair'].filter(key => typeof candidate.coverage[key] === 'boolean').map(key => [key, candidate.coverage[key]])),
          coverageSufficient: candidate.coverageSufficient, modelMatch: candidate.modelMatch, referenceVerification: candidate.referenceVerification,
          verificationBasis: candidate.verificationBasis, sourceIndexed: candidate.sourceIndexed, riskLevel: candidate.riskLevel, directEligible: candidate.directEligible, excluded: candidate.excluded,
          ...(isRecord(candidate.retrieval) && oneOf(candidate.retrieval.tier, ['exact', 'series', 'component', 'general']) && texts(candidate.retrieval.basis, 12, 500) && typeof candidate.retrieval.referenceOnly === 'boolean'
            ? { retrieval: { tier: candidate.retrieval.tier, basis: [...candidate.retrieval.basis], referenceOnly: candidate.retrieval.referenceOnly } } : {}) }));
    }
  }
  const trace = value.diagnosisTrace;
  if (isRecord(trace) && isRecord(trace.timings) && ['retrievalCount', 'aiAttempts', 'aiSuccesses', 'contextChars'].every(key => finite(trace[key]))
    && (trace.aiProvider === null || oneOf(trace.aiProvider, ['gemini', 'deepseek'])) && trace.scoreMethod === 'keyword-weighted-overlap'
    && texts(trace.sentKnowledgeIds, 40) && ['retrievalMs', 'decisionMs', 'externalAiMs', 'totalMs'].every(key => finite(trace.timings[key]))) {
    result.diagnosisTrace = { retrievalCount: trace.retrievalCount, aiAttempts: trace.aiAttempts, aiSuccesses: trace.aiSuccesses, contextChars: trace.contextChars,
      aiProvider: trace.aiProvider, scoreMethod: trace.scoreMethod, sentKnowledgeIds: [...trace.sentKnowledgeIds],
      timings: { retrievalMs: trace.timings.retrievalMs, decisionMs: trace.timings.decisionMs, externalAiMs: trace.timings.externalAiMs, totalMs: trace.timings.totalMs } };
  }
  const flow = value.roleFlow;
  if (isRecord(flow) && texts(flow.untaggedEntryIds, 40) && KNOWLEDGE_ROLES.every(role => Array.isArray(flow[role]) && flow[role].length <= 40)) {
    const roleFlow = { untaggedEntryIds: [...flow.untaggedEntryIds], ...(texts(flow.generalKnowledgeIds, 40) ? { generalKnowledgeIds: [...flow.generalKnowledgeIds] } : {}) } as NonNullable<ChatResponse['roleFlow']>;
    for (const role of KNOWLEDGE_ROLES) roleFlow[role] = flow[role].filter((item: unknown) => isRecord(item) && text(item.entryId, 100) && text(item.heading))
      .map((item: Record<string, unknown>) => ({ entryId: item.entryId as string, heading: item.heading as string,
        ...(text(item.sourceId, 100) ? { sourceId: item.sourceId } : {}), ...(text(item.sourceTitle) ? { sourceTitle: item.sourceTitle } : {}),
        ...(text(item.locator) ? { locator: item.locator } : {}), ...(isRecord(item.pages) ? { pages: { ...(text(item.pages.pdf, 100) ? { pdf: item.pages.pdf } : {}), ...(text(item.pages.printed, 100) ? { printed: item.pages.printed } : {}) } } : {}) }));
    result.roleFlow = roleFlow;
  }
  return result;
}

export function parseFaultCodes(value: string): string[] {
  const codes = value.split(/[\s,，;；]+/).filter(Boolean);
  if (codes.length > 20 || codes.some(code => code.length > 32)) throw new Error('故障码最多20个，每个不超过32字符');
  return [...new Set(codes)];
}

export function composeDiagnosticQuestion(question: string, attachment?: DiagnosticTextAttachment): string {
  return attachment ? `${question.trim()}\n\n用户提供的故障信息文本（${attachment.name}；未经核验）：\n${attachment.text}`.trim() : question.trim();
}

/** The file stays local until the user sends its visible text with the question. */
export async function readDiagnosticTextAttachment(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<DiagnosticTextAttachment> {
  if (!/\.(txt|log|csv|json)$/i.test(file.name)) throw new Error('仅支持 txt、log、csv、json 文本；暂不支持图片识别');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('文本文件不能超过16KB，请只保留相关故障信息');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('文本文件不能超过16KB');
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '').trim();
  if (!content || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content)) throw new Error('请提供非空UTF-8文本文件，不支持二进制文件');
  const attachment = { name: file.name.replace(/[\r\n<>]/g, '').slice(0, 100), text: content };
  if (composeDiagnosticQuestion('', attachment).length > MAX_QUESTION_LENGTH) throw new Error('文本内容过长，请缩短后再添加；描述与文件合计上限2000字符');
  return attachment;
}

export function parseHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message) => isRecord(message) && typeof message.id === 'string' &&
    typeof message.content === 'string' && (message.role === 'user' || message.role === 'assistant'))
    .slice(-100).map((message) => ({
      ...parseChatMetadata(message),
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

export function parseMachineContext(value: unknown): DiagnosticContext {
  const context = isRecord(value) ? value : {};
  const type = typeof context.machineType === 'string' ? context.machineType : '';
  // Previously saved English labels must still match the Chinese option values.
  const machineType = MACHINE_TYPES_ZH[MACHINE_TYPES_EN.indexOf(type)] || type;
  return {
    machineType: MACHINE_TYPES_ZH.includes(machineType) ? machineType : '',
    brand: typeof context.brand === 'string' ? context.brand.slice(0, 100) : '',
    model: typeof context.model === 'string' ? context.model.slice(0, 100) : '',
    ...(text(context.engineModel, 100) ? { engineModel: context.engineModel } : {}),
    ...(texts(context.faultCodes, 20, 32) ? { faultCodes: [...context.faultCodes] } : {}),
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
      engineModel: typeof imported.engineModel === 'string' ? suppliedContext.engineModel : context.engineModel,
      faultCodes: Array.isArray(imported.faultCodes) ? suppliedContext.faultCodes : context.faultCodes,
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

export function saveMachineContext(context: DiagnosticContext, storage?: SessionStorage): void {
  try {
    (storage ?? localStorage).setItem(META_KEY, JSON.stringify(context));
  } catch { /* Active chat does not depend on browser storage. */ }
}

export function createChatRequest(messages: ChatMessage[], question: string, context: DiagnosticContext, historyLimit = 20): ChatRequest {
  return {
    messages: [...parseHistory(messages).slice(-Math.min(38, Math.max(0, historyLimit))).map(({ role, content }) => ({
      role: role as 'user' | 'assistant', content,
    })), { role: 'user', content: question }],
    machineType: context.machineType || undefined,
    brand: context.brand || undefined,
    model: context.model || undefined,
    ...(context.engineModel?.trim() ? { engineModel: context.engineModel.trim() } : {}),
    ...(context.faultCodes?.length ? { faultCodes: [...context.faultCodes] } : {}),
  };
}

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
