import type { ChatResponse, DiagnosisTrace } from '../../shared/chat';
import type { DiagnosisCandidateAssessment } from '../../shared/diagnosis';
import type { SessionDetail, PriorDeviceReport } from '../../shared/memory';
import { resolveDiagnosticContext } from '../knowledge/conversation';
import { buildSystemPrompt } from '../knowledge/systemPrompt';
import { buildDiagnosticReply, renderDiagnosticReply } from './reply';
import { validateDiagnosticAnswer } from './answerGuard';
import { decideCoordination, ROUTE_MESSAGES } from '../knowledge/coordination';
import { hasIndexedReference, referenceVerification } from '../knowledge/evidence';
import { retrieve, selectPromptChunks, formatForPrompt, hasApplicableManual } from '../knowledge/retriever';
import { buildRoleFlow } from '../knowledge/roles';
import { memoryPrompt, recentMessages } from '../memory/context';
import type { LlmRouter } from '../llm/router';
import { ProviderError } from '../llm/types';
import type { DiagnosticRequest } from './request';
import { diagnosticRuntimeConfig, type DiagnosticRuntimeConfig } from './config';

export interface DiagnosticMemory {
  session: SessionDetail;
  priorReports: PriorDeviceReport[];
}
export type DiagnosticProvider = Pick<LlmRouter, 'hasAnyConfigured' | 'chat'> & Partial<Pick<LlmRouter, 'getStatus'>>;
export type DiagnosticService = (request: DiagnosticRequest, memory?: DiagnosticMemory) => Promise<ChatResponse>;
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
}

/** One retrieval feeds the local decision and the generation prompt. No model classifies requests. */
export function createDiagnosticService(llm: DiagnosticProvider, dependencies: DiagnosticDependencies = {}): DiagnosticService {
  const search = dependencies.retrieve ?? retrieve;
  const now = dependencies.now ?? (() => performance.now());
  return async ({ history, machineType, brand, model, engineModel, faultCodes, diagnosisMode }, memory) => {
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
    const localResponse = (failed = false, outputIssues: string[] = []): ChatResponse => {
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
      ...scope, retrieved: promptChunks, contextMaxChars: config.contextMaxChars });
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
      const validation = validateDiagnosticAnswer(outcome.result.content, promptChunks, { trustedEvidenceIds });
      if (!validation.ok) {
        displayed = admissible;
        return localResponse(false, [...new Set(validation.issues.map(issue => issue.code))]);
      }
      const diagnosticReply = { ...replyPlan(), aiSupplement: outcome.result.content };
      const content = renderDiagnosticReply(diagnosticReply);
      if (content.length > 16000) {
        displayed = admissible;
        return localResponse(false, ['answer_too_long']);
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
      return localResponse(true);
    }
  };
}
