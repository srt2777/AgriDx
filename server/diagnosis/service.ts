import type { ChatResponse, DiagnosisTrace } from '../../shared/chat';
import type { DiagnosisCandidateAssessment } from '../../shared/diagnosis';
import type { SessionDetail, PriorDeviceReport } from '../../shared/memory';
import { resolveDiagnosticContext } from '../knowledge/conversation';
import { buildSystemPrompt } from '../knowledge/systemPrompt';
import { buildDiagnosticReply, renderDiagnosticReply } from './reply';
import { filterDiagnosticAnswer } from './answerGuard';
import { decideCoordination, ROUTE_MESSAGES } from '../knowledge/coordination';
import { hasIndexedReference, referenceVerification } from '../knowledge/evidence';
import { retrieve, selectPromptChunks, formatForPrompt, hasApplicableManual } from '../knowledge/retriever';
import { buildRoleFlow } from '../knowledge/roles';
import { memoryPrompt, recentMessages } from '../memory/context';
import type { LlmRouter } from '../llm/router';
import { ProviderError, type ChatMessage } from '../llm/types';
import type { DiagnosticRequest } from './request';
import { diagnosticRuntimeConfig, type DiagnosticRuntimeConfig } from './config';
import { runAgent, type AgentRunResult, type AgentToolEvent } from '../../agent/runner';
import { buildContextRegistry } from '../../agent/context-tools';

export interface DiagnosticMemory {
  session: SessionDetail;
  priorReports: PriorDeviceReport[];
}
export type DiagnosticProvider = Pick<LlmRouter, 'hasAnyConfigured' | 'chat'> & Partial<Pick<LlmRouter, 'getStatus' | 'toolProvider'>>;
export type DiagnosticService = (request: DiagnosticRequest, memory?: DiagnosticMemory, signal?: AbortSignal) => Promise<ChatResponse>;
export interface DiagnosticDecisionLog {
  mode: string;
  requestedMode: string;
  route: string;
  reason: string;
  riskLevel?: string;
  knowledgeIds: string[];
  provider: string;
  trace: DiagnosisTrace;
  candidates: DiagnosisCandidateAssessment[];
}
export interface DiagnosticDependencies {
  retrieve?: typeof retrieve;
  now?: () => number;
  config?: Partial<DiagnosticRuntimeConfig>;
  onDecision?: (event: DiagnosticDecisionLog) => void | Promise<void>;
  /** Receives the redacted outcome of each background shadow run; defaults to a one-line server log. */
  onShadowResult?: (report: ShadowLoopReport) => void;
  /** Test hook for the shadow wall-clock deadline; production uses 8 s. */
  shadowTimeoutMs?: number;
}

/** Redacted shadow outcome: tool names, timings and status only; never arguments, content or credentials. */
export interface ShadowLoopReport {
  status: AgentRunResult['status'] | 'error';
  reason: string | null;
  provider: string;
  durationMs: number;
  toolEvents: AgentToolEvent[];
}

const SHADOW_TOOLS = ['resolve_machine_scope', 'search_knowledge', 'browse_knowledge', 'knowledge_stats', 'calculator', 'get_current_time',
  'get_knowledge_entry', 'get_session_state', 'list_prior_reports', 'explore_relations', 'ask_user_for_info'] as const;
const SHADOW_TIMEOUT_MS = 8_000;
const SHADOW_MAX_IN_FLIGHT = 4;

function logShadowResult(report: ShadowLoopReport) {
  const tools = report.toolEvents.map(event => `${event.tool}:${event.ok ? 'ok' : event.error_type ?? 'error'}`).join(',') || 'none';
  console.info(`[agent-shadow] provider=${report.provider} status=${report.status}${report.reason ? ` reason=${report.reason}` : ''} ms=${Math.round(report.durationMs)} tools=${tools}`);
}

/** One retrieval feeds the local decision and the generation prompt. No model classifies requests. */
export function createDiagnosticService(llm: DiagnosticProvider, dependencies: DiagnosticDependencies = {}): DiagnosticService {
  const search = dependencies.retrieve ?? retrieve;
  const now = dependencies.now ?? (() => performance.now());
  const reportShadow = dependencies.onShadowResult ?? logShadowResult;
  let shadowInFlight = 0;
  let warnedNoToolProvider = false;
  /** Fire-and-forget: errors are caught and logged; the caller signal and an 8 s deadline still bound the run. */
  const startShadow = (input: { messages: ChatMessage[]; query: string; context: Record<string, unknown>; memory?: DiagnosticMemory;
    signal?: AbortSignal; allowExternal: boolean; guard: (content: string) => string | null }) => {
    const provider = llm.toolProvider?.() ?? null;
    if (!provider) {
      if (!warnedNoToolProvider) {
        warnedNoToolProvider = true;
        console.warn('[agent-shadow] AGENT_LOOP=shadow is set but no configured provider supports tool calls (Gemini does not; configure DEEPSEEK_API_KEY); shadow loop skipped.');
      }
      return;
    }
    if (shadowInFlight >= SHADOW_MAX_IN_FLIGHT) {
      console.warn(`[agent-shadow] skipped: ${SHADOW_MAX_IN_FLIGHT} shadow runs already in flight`);
      return;
    }
    shadowInFlight++;
    const started = now();
    void (async (): Promise<ShadowLoopReport> => {
      const result = await runAgent({ provider, registry: buildContextRegistry(input.memory), messages: input.messages, query: input.query, context: input.context,
        allowedTools: SHADOW_TOOLS, allowExternal: input.allowExternal, timeoutMs: dependencies.shadowTimeoutMs ?? SHADOW_TIMEOUT_MS, signal: input.signal, guard: input.guard });
      return { status: result.status, reason: 'reason' in result ? result.reason : null, provider: provider.name, durationMs: now() - started, toolEvents: result.toolEvents };
    })().catch((error: unknown): ShadowLoopReport => {
      console.warn(`[agent-shadow] failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      return { status: 'error', reason: 'unexpected_error', provider: provider.name, durationMs: now() - started, toolEvents: [] };
    }).then(report => {
      try { reportShadow(report); } catch { /* Reporting must never surface to the request. */ }
    }).finally(() => { shadowInFlight--; });
  };
  return async ({ history, machineType, brand, model, engineModel, faultCodes, diagnosisMode, telemetrySummary }, memory, signal) => {
    const started = now();
    const config = { ...diagnosticRuntimeConfig(), ...dependencies.config };
    const context = resolveDiagnosticContext(history, { machineType, brand, model });
    const { query, currentQuery, symptomQuery, clarificationNeeded } = context;
    const scope = { ...context.scope, engineModel, faultCodes };
    const retrievalStart = now();
    // A denied identity is an explicit exception: do not query or cite the old machine.
    const retrieved = clarificationNeeded ? [] : search(query, config.topK, scope);
    const retrievalMs = now() - retrievalStart;
    const decisionStart = now();
    const coordination = decideCoordination({ query, currentQuery, scope, retrieved, clarificationNeeded,
      requestedMode: diagnosisMode, llmConfigured: llm.hasAnyConfigured(), llmConfigValid: llm.getStatus?.().configValid,
      manualAvailable: dependencies.retrieve || clarificationNeeded ? undefined : hasApplicableManual(query, scope) });
    const decisionMs = now() - decisionStart;
    const excluded = new Set(coordination.excludedKnowledgeIds ?? []);
    const admissible = retrieved.filter(chunk => referenceVerification(chunk.status) !== 'failed' &&
      (!chunk.entryId || !excluded.has(chunk.entryId)));
    let displayed = admissible;
    const trace: DiagnosisTrace = { retrievalCount: clarificationNeeded ? 0 : 1, aiAttempts: 0, aiSuccesses: 0, aiProvider: null,
      scoreMethod: 'keyword-weighted-overlap', contextChars: 0, sentKnowledgeIds: [],
      timings: { retrievalMs, decisionMs, externalAiMs: 0, totalMs: 0 } };
    const metadata = () => ({ knowledgeChunks: displayed.length, knowledgeSources: displayed.map(chunk => ({
      entryId: chunk.entryId, sourceId: chunk.sourceId, source: chunk.source, heading: chunk.heading,
      entryType: chunk.entryType, diagnosticEvidence: chunk.diagnosticEvidence,
      ...(chunk.generalEvidence ? { generalEvidence: true as const } : {}),
      evidenceKind: chunk.entryType === '通识学习' ? 'general-knowledge' as const : chunk.entryId ? 'archive' as const : 'prompt' as const,
      evidenceLabel: chunk.entryType === '通识学习' ? '通识（无手册页码）' : chunk.entryId ? `手册：${chunk.sourceTitle ?? chunk.sourceId ?? '来源待核实'}${chunk.pages?.pdf ? `，PDF第${chunk.pages.pdf}页` : ''}${chunk.pages?.printed ? `，印刷第${chunk.pages.printed}页` : ''}` : '信息收集提示（非手册）',
      locator: chunk.locator, version: chunk.version, applicability: chunk.applicability, status: chunk.status,
      ...(chunk.retrieval ? { retrieval: { ...chunk.retrieval, basis: [...chunk.retrieval.basis] } } : {}),
      referenceVerification: referenceVerification(chunk.status), sourceIndexed: hasIndexedReference(chunk),
      ...(chunk.sourceTitle ? { sourceTitle: chunk.sourceTitle } : {}),
      ...(chunk.scopeBoundary ? { scopeBoundary: chunk.scopeBoundary } : {}),
      ...(chunk.models ? { models: [...chunk.models] } : chunk.model ? { models: [chunk.model] } : {}),
      ...(chunk.engineModel ? { engineModel: chunk.engineModel } : {}),
      ...(chunk.faultCodes ? { faultCodes: [...chunk.faultCodes] } : {}),
      ...(chunk.pages ? { pages: { ...chunk.pages } } : {}),
      ...(chunk.roles ? { roles: [...chunk.roles], roleBasis: chunk.roleBasis } : {}),
      ...(chunk.riskLevel ? { riskLevel: chunk.riskLevel } : {}),
    })), roleFlow: buildRoleFlow(displayed) });
    const finish = (payload: ChatResponse): ChatResponse => {
      trace.timings.totalMs = now() - started;
      payload.diagnosisTrace = trace;
      const usedIds = new Set([...(payload.diagnosticReply?.background ?? []), ...(payload.diagnosticReply?.causes ?? []), ...(payload.diagnosticReply?.suggestions ?? [])]
        .flatMap(item => item.evidenceIds));
      const promptIds = new Set(trace.sentKnowledgeIds);
      for (const source of payload.knowledgeSources) source.usage = source.entryId && usedIds.has(source.entryId)
        ? 'answer-evidence' : source.entryId && promptIds.has(source.entryId) && payload.provider !== 'knowledge-base'
          ? 'prompt-context' : 'reference-only';
      payload.coordination!.knowledgeIds = displayed.flatMap(chunk => chunk.entryId ? [chunk.entryId] : []);
      // No raw question, history, device identifiers or credentials enter routing logs.
      const event: DiagnosticDecisionLog = { mode: coordination.effectiveMode, requestedMode: coordination.requestedMode, route: payload.coordination!.route,
        reason: payload.coordination!.reason, riskLevel: coordination.riskLevel,
        knowledgeIds: displayed.flatMap(chunk => chunk.entryId ? [chunk.entryId] : []), provider: payload.provider, trace,
        candidates: coordination.candidates ?? [] };
      const defer = typeof setImmediate === 'function' ? setImmediate : (callback: () => void) => setTimeout(callback, 0);
      if (dependencies.onDecision || config.logDecisions) defer(() => {
        try {
          if (dependencies.onDecision) Promise.resolve(dependencies.onDecision(event)).catch(() => {});
          else console.info(`[diagnosis] ${JSON.stringify(event)}`);
        } catch { /* Logging failure must not change a diagnosis response. */ }
      });
      return payload;
    };
    const replyPlan = (route = coordination) => buildDiagnosticReply({
      query, currentQuery, symptomQuery, chunks: displayed, scope, coordination: route,
      // User observations guide follow-up selection; they are not verified repair evidence.
      progress: [memory?.session.progress, ...history.filter(message => message.role === 'user').map(message => message.content)].filter(Boolean).join('\n'),
      priorReports: memory?.priorReports,
    });
    const localResponse = (failed = false, outputIssues: string[] = [], failureKind?: string): ChatResponse => {
      const rejected = outputIssues.length > 0;
      const route = failed || rejected ? { ...coordination, route: 'local' as const,
        reason: rejected ? 'output_rejected' as const : 'provider_unavailable' as const,
        aiRequired: false, ...(rejected ? { outputIssues } : {}) } : coordination;
      const fallbackReason = failed ? 'provider_unavailable' as const : route.reason === 'llm_not_configured' ? 'not_configured' as const : undefined;
      if (route.reason === 'direct_reference') {
        const directIds = new Set(route.directEligibleIds ?? []);
        displayed = admissible.filter(chunk => chunk.entryId && directIds.has(chunk.entryId));
      }
      const diagnosticReply = replyPlan(route);
      if (telemetrySummary) diagnosticReply.sourceNote += '\n仿真演示数据，不是真实设备读数，不得据此给出确定性故障结论。';
      const unavailable = failed ? failureKind === 'timeout' ? '已尝试外部 AI，但请求超时；本次先提供本地安全观察建议。' : '已尝试外部 AI，但服务暂不可用；本次先提供本地安全观察建议。'
        : rejected ? '外部 AI 已返回，但内容未通过来源或安全检查；本次保留本地安全建议。'
        : route.reason === 'llm_not_configured' ? '当前服务端未配置外部 AI 密钥，本次没有调用外部模型。'
        : route.reason === 'server_local_only' ? '当前环境只启用本地知识检索，本次没有调用外部模型。'
        : route.reason === 'llm_config_invalid' || route.reason === 'invalid_config' ? '当前 AI 配置无效，本次没有调用外部模型。' : '';
      if (unavailable) diagnosticReply.understanding += unavailable;
      const content = renderDiagnosticReply(diagnosticReply);
      return finish({
        choices: [{ message: { role: 'assistant', content } }], diagnosticReply,
        model: failed || rejected ? 'kb-rag-fallback (本地备用引擎)' : 'kb-rag-engine (本地知识引擎)', provider: 'knowledge-base',
        fellBack: Boolean(fallbackReason) || rejected, ...(fallbackReason ? { fallbackReason } : {}), ...metadata(), answerMode: 'local-evidence',
        localSummary: content,
        coordination: route, coordinationMessage: ROUTE_MESSAGES[route.reason],
      });
    };
    if (coordination.route !== 'ai') return localResponse();
    const promptChunks = selectPromptChunks(admissible, config.contextMaxChars);
    displayed = promptChunks;
    const { message: systemMessage, answerMode } = buildSystemPrompt({ query, currentQuery, clarificationNeeded,
      ...scope, retrieved: promptChunks, contextMaxChars: config.contextMaxChars, telemetrySummary: telemetrySummary?.text });
    const groundedPrompt = promptChunks.some(chunk => chunk.generalEvidence === true && !scope.brand && !scope.model) || promptChunks.some(chunk => !chunk.retrieval?.referenceOnly &&
      coordination.candidates?.some(candidate => candidate.entryId === chunk.entryId && !candidate.excluded &&
        candidate.modelMatch === 'exact' && candidate.sourceIndexed && candidate.referenceVerification === 'verified'));
    systemMessage.content += '\n本次回答路径为AI补充：来源核验仅指文献核对，未实车验证。待核验、适用性待确认或未提供发动机/故障码适配元数据的资料只能作参考；不能作为本机操作或故障码含义的依据。历史回答和用户检查报告也不是手册证据。';
    if (memory) systemMessage.content += memoryPrompt(memory.session, memory.priorReports);
    trace.contextChars = formatForPrompt(promptChunks, config.contextMaxChars).length;
    trace.sentKnowledgeIds = promptChunks.flatMap(chunk => chunk.entryId ? [chunk.entryId] : []);
    const externalStart = now();
    try {
      trace.aiAttempts = 1;
      const outcome = await llm.chat([systemMessage, ...(memory ? recentMessages(history) : history)]);
      trace.timings.externalAiMs = now() - externalStart;
      trace.aiAttempts = outcome.attempts ?? 1;
      trace.aiSuccesses = 1;
      trace.aiProvider = outcome.result.provider;
      const trustedEvidenceIds = promptChunks.flatMap(chunk => chunk.entryId && !chunk.retrieval?.referenceOnly &&
        coordination.candidates?.some(candidate => candidate.entryId === chunk.entryId && !candidate.excluded &&
          candidate.modelMatch === 'exact' && candidate.sourceIndexed && candidate.referenceVerification === 'verified') ? [chunk.entryId] : []);
      const filtered = filterDiagnosticAnswer(outcome.result.content, promptChunks, { trustedEvidenceIds, model: scope.model });
      if (!filtered.content) {
        displayed = admissible;
        return localResponse(false, [...new Set(filtered.removedIssues)]);
      }
      const diagnosticReply = { ...replyPlan(), aiSupplement: filtered.content };
      // Let a useful AI analysis lead; local facts and inferred analysis remain separate.
      diagnosticReply.understanding = `${[scope.brand, scope.model].filter(Boolean).join(' ')}${scope.model ? '：' : ''}${(symptomQuery || currentQuery).replace(/[。！？?!]+$/u, '')}。下面区分已有资料与通用分析，原因尚待检查验证。`;
      if (/[？?]|请.{0,12}(?:补充|确认)/.test(filtered.content)) diagnosticReply.questions = [];
      if (filtered.removedIssues.length) {
        diagnosticReply.aiSupplement = '已移除未通过来源或安全检查的段落，以下保留通用分析：\n\n' + filtered.content;
        coordination.outputIssues = [...new Set(filtered.removedIssues)];
      }
      const content = renderDiagnosticReply(diagnosticReply);
      if (content.length > 16000) {
        displayed = admissible;
        return localResponse(false, ['answer_too_long']);
      }
      // Shadow is opt-in, runs after the ordinary answer is final and is never awaited, so it cannot
      // delay, replace or bypass the coordinated answer and answerGuard.
      if (config.agentLoop === 'shadow' && coordination.route === 'ai') {
        startShadow({ messages: [systemMessage, ...(memory ? recentMessages(history) : history)], query: currentQuery, context: scope, memory, signal, allowExternal: coordination.route === 'ai',
          guard: value => filterDiagnosticAnswer(value, promptChunks, { trustedEvidenceIds, model: scope.model }).content || null });
      }
      return finish({ choices: [{ message: { role: 'assistant', content } }], diagnosticReply,
        model: outcome.result.model, provider: outcome.result.provider, fellBack: outcome.fellBack,
        ...metadata(), answerMode: groundedPrompt ? answerMode : 'general-guidance', coordination, coordinationMessage: ROUTE_MESSAGES[coordination.reason] });
    } catch (error) {
      trace.timings.externalAiMs = now() - externalStart;
      if (!(error instanceof ProviderError)) throw error;
      trace.aiAttempts = error.attempts || 1;
      console.warn(`[chat] provider error: ${error.provider}/${error.kind}`);
      displayed = admissible;
      return localResponse(true, [], error.kind);
    }
  };
}
