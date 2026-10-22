import type { ChatResponse, DiagnosisTrace } from '../../shared/chat';
import type { DiagnosisCandidateAssessment } from '../../shared/diagnosis';
import type { SessionDetail, PriorDeviceReport } from '../../shared/memory';
import { resolveDiagnosticContext } from '../knowledge/conversation';
import { generateLocalKnowledgeReply, localReplySummary } from '../knowledge/fallbackDiagnosis';
import { buildSystemPrompt, hasDiagnosticEvidence } from '../knowledge/systemPrompt';
import { decideCoordination, ROUTE_MESSAGES } from '../knowledge/coordination';
import { hasIndexedReference, referenceVerification } from '../knowledge/evidence';
import { retrieve, selectPromptChunks, formatForPrompt } from '../knowledge/retriever';
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
      requestedMode: diagnosisMode, llmConfigured: llm.hasAnyConfigured(), llmConfigValid: llm.getStatus?.().configValid });
    const decisionMs = now() - decisionStart;
    const excluded = new Set(coordination.excludedKnowledgeIds ?? []);
    const admissible = retrieved.filter(chunk => referenceVerification(chunk.status) !== 'failed' &&
      (!chunk.entryId || !excluded.has(chunk.entryId)));
    // A reference with uncertain review/applicability may be listed, never presented as instructions.
    const reliable = admissible.filter(chunk => hasDiagnosticEvidence([chunk]) && hasIndexedReference(chunk) &&
      referenceVerification(chunk.status) === 'verified' && chunk.applicability === 'matched' &&
      coordination.candidates?.some(candidate => candidate.entryId === chunk.entryId && candidate.modelMatch === 'exact'));
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
      referenceVerification: referenceVerification(chunk.status), sourceIndexed: hasIndexedReference(chunk),
      ...(chunk.sourceTitle ? { sourceTitle: chunk.sourceTitle } : {}),
      ...(chunk.pages ? { pages: { ...chunk.pages } } : {}),
      ...(chunk.roles ? { roles: [...chunk.roles], roleBasis: chunk.roleBasis } : {}),
      ...(chunk.riskLevel ? { riskLevel: chunk.riskLevel } : {}),
    })), roleFlow: buildRoleFlow(displayed) });
    const finish = (payload: ChatResponse): ChatResponse => {
      trace.timings.totalMs = now() - started;
      payload.diagnosisTrace = trace;
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
    const localResponse = (failed = false): ChatResponse => {
      const route = failed ? { ...coordination, route: 'local' as const, reason: 'provider_unavailable' as const, aiRequired: false } : coordination;
      const fallbackReason = failed ? 'provider_unavailable' as const : route.reason === 'llm_not_configured' ? 'not_configured' as const : undefined;
      const clarification = route.reason === 'identity_required'
        ? '**【需要补充】** 请提供品牌和铭牌上的完整型号，再核对故障码或参数。不能用其他型号的数据代替。'
        : '**【需要确认机型】** 请确认本次设备的品牌、完整型号及发动机信息；确认前暂停引用冲突资料。';
      const needsClarification = route.route === 'clarify';
      const safe = route.route === 'safe';
      const directIds = new Set(route.directEligibleIds ?? []);
      const learning = admissible.filter(chunk => chunk.entryType === '通识学习' && chunk.diagnosticEvidence === false);
      const localEvidence = route.reason === 'direct_reference' ? reliable.filter(chunk => directIds.has(chunk.entryId!)) : [...reliable, ...learning];
      if (route.reason === 'direct_reference') displayed = localEvidence;
      const memoryNote = memory?.session.progress && !needsClarification && !safe
        ? `**【已记录的检查进度 · 用户报告，待核实】**\n${memory.session.progress}\n\n以下为资料排查清单，请优先处理未完成项目；已完成项目仅在结果变化或需要复核时再检查。\n\n` : '';
      const priorNote = memory?.priorReports.length && !needsClarification && !safe
        ? `**【同一设备的历史检查报告 · 待核实】**\n${memory.priorReports.map(r => `${r.updatedAt.slice(0, 10)}：${r.progress}`).join('\n')}\n\n以上是历史用户报告，不代表本次已检查或当前仍正常。\n\n` : '';
      const referenceNotice = admissible.filter(chunk => !reliable.includes(chunk) && !learning.includes(chunk) && chunk.entryId).map(chunk =>
        `- ${chunk.entryId}／${chunk.sourceId}；${chunk.version}；${chunk.locator?.match(/(?:PDF|印刷)[^；;。\n]*?页(?:[^；;。\n]*页)?/g)?.join('；') || '原文位置见来源记录'}；核验状态：${chunk.status}。\n  适用限制：${chunk.scopeBoundary || '具体适用条件尚未明确'}。`).join('\n');
      const references = referenceNotice && route.reason !== 'direct_reference' ? `\n\n**【参考资料 · 适用或核验仍待确认】**\n${referenceNotice}\n上述资料只作来源参考，本次不展示其具体操作步骤或参数。` : '';
      const content = needsClarification ? clarification : safe
        ? '**【安全处置优先】**\n本次问题涉及制动、转向、动力输出、高压或其他尚未排除的维修风险。请停止危险作业，按本机安全规程安全停机并联系具备相应资质的维修人员。不要带压、带电拆检，不要绕过安全联锁或在悬空机具下作业。\n\n**【需要补充】**\n请记录故障发生条件、报警或故障码及已观察到的现象；品牌、完整型号及必要配置尚未明确时，请同时确认。匹配资料也不代表风险已经解除，本次不提供拆解、调压或试操作步骤。'
        : generateLocalKnowledgeReply(query, localEvidence, scope, fallbackReason, symptomQuery || currentQuery, false) + references;
      return finish({
        choices: [{ message: { role: 'assistant', content: memoryNote + priorNote + content } }],
        model: failed ? 'kb-rag-fallback (本地备用引擎)' : 'kb-rag-engine (本地知识引擎)', provider: 'knowledge-base',
        fellBack: Boolean(fallbackReason), ...(fallbackReason ? { fallbackReason } : {}), ...metadata(), answerMode: 'local-evidence',
        localSummary: (memoryNote + priorNote + (needsClarification || safe ? content :
          localReplySummary(symptomQuery, localEvidence, scope, fallbackReason ?? 'local_selected') +
          (references ? `\n\n参考来源：${admissible.flatMap(chunk => chunk.entryId ? [chunk.entryId] : []).join('、')}。核验或适用条件待确认；请展开查看来源和限制，本次不据此提供维修步骤。` : ''))).slice(0, 4000),
        coordination: route, coordinationMessage: ROUTE_MESSAGES[route.reason],
      });
    };
    if (coordination.route !== 'ai') return localResponse();
    const promptChunks = selectPromptChunks(admissible, config.contextMaxChars);
    displayed = promptChunks;
    const { message: systemMessage, answerMode } = buildSystemPrompt({ query, currentQuery, clarificationNeeded,
      ...scope, retrieved: promptChunks, contextMaxChars: config.contextMaxChars });
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
      return finish({ choices: [{ message: { role: 'assistant', content: outcome.result.content } }],
        model: outcome.result.model, provider: outcome.result.provider, fellBack: outcome.fellBack,
        ...metadata(), answerMode, coordination, coordinationMessage: ROUTE_MESSAGES[coordination.reason] });
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
