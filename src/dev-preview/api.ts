/// <reference types="node" />
import { recordQuestion } from './telemetry';
import { PreviewMemoryStore, previewMemoryRoute } from './memory';
import { MemoryError, summarizeReports } from '../../shared/memory-validation';
import { loadKnowledgeBase, stats, retrieve, hasApplicableManual } from '../../server/knowledge/retriever';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../../server/knowledge/catalog';
import { resolveDiagnosticContext } from '../../server/knowledge/conversation';
import { decideCoordination, ROUTE_MESSAGES } from '../../server/knowledge/coordination';
import { referenceVerification, hasIndexedReference } from '../../server/knowledge/evidence';
import { buildRoleFlow } from '../../server/knowledge/roles';
import { buildDiagnosticReply, renderDiagnosticReply } from '../../server/diagnosis/reply';
import { diagnosticRuntimeConfig } from '../../server/diagnosis/config';
import { DiagnosticInputError, parseDiagnosticRequest, type DiagnosticRequest } from '../../server/diagnosis/request';
import type { ChatResponse } from '../../shared/chat';
import type { SessionDetail, PriorDeviceReport } from '../../shared/memory';
import { CATALOG_FILTER_KEYS, validCatalogCondition, type CatalogFilters } from '../../shared/knowledge-catalog';

let ready = false;
/** Browser-only orchestration of the same deterministic router and reply builder.
 * Never import the server service/provider graph or offer an external-AI callback.
 */
function diagnose(request: DiagnosticRequest, memory?: { session: SessionDetail; priorReports: PriorDeviceReport[] }): ChatResponse {
  const started = performance.now();
  const context = resolveDiagnosticContext(request.history, request);
  const scope = { ...context.scope, engineModel: request.engineModel, faultCodes: request.faultCodes };
  const retrievalStarted = performance.now();
  const retrieved = context.clarificationNeeded ? [] : retrieve(context.query, diagnosticRuntimeConfig().topK, scope);
  const retrievalMs = performance.now() - retrievalStarted;
  const decisionStarted = performance.now();
  const coordination = decideCoordination({ query: context.query, currentQuery: context.currentQuery, scope, retrieved,
    clarificationNeeded: context.clarificationNeeded, requestedMode: 'knowledge_only', llmConfigured: false,
    manualAvailable: context.clarificationNeeded ? undefined : hasApplicableManual(context.query, scope) });
  const decisionMs = performance.now() - decisionStarted;
  const excluded = new Set(coordination.excludedKnowledgeIds ?? []);
  const admissible = retrieved.filter(chunk => referenceVerification(chunk.status) !== 'failed' && (!chunk.entryId || !excluded.has(chunk.entryId)));
  const direct = new Set(coordination.directEligibleIds ?? []);
  const displayed = coordination.reason === 'direct_reference' ? admissible.filter(chunk => chunk.entryId && direct.has(chunk.entryId)) : admissible;
  const diagnosticReply = buildDiagnosticReply({ query: context.query, currentQuery: context.currentQuery, symptomQuery: context.symptomQuery,
    chunks: displayed, scope, coordination,
    progress: [memory?.session.progress, ...request.history.filter(message => message.role === 'user').map(message => message.content)].filter(Boolean).join('\n'),
    priorReports: memory?.priorReports });
  diagnosticReply.understanding += '当前为仅本地检索的开发预览，本次没有调用外部 AI。';
  const content = renderDiagnosticReply(diagnosticReply);
  const used = new Set([...(diagnosticReply.background ?? []), ...diagnosticReply.causes, ...diagnosticReply.suggestions].flatMap(item => item.evidenceIds));
  coordination.knowledgeIds = displayed.flatMap(chunk => chunk.entryId ? [chunk.entryId] : []);
  const fallbackReason = coordination.reason === 'llm_not_configured' ? 'not_configured' as const : undefined;
  return { choices: [{ message: { role: 'assistant', content } }], diagnosticReply, localSummary: content,
    provider: 'knowledge-base', model: 'kb-rag-engine (本地知识引擎)', answerMode: 'local-evidence', fellBack: !!fallbackReason,
    ...(fallbackReason ? { fallbackReason } : {}), coordination, coordinationMessage: ROUTE_MESSAGES[coordination.reason],
    knowledgeChunks: displayed.length, roleFlow: buildRoleFlow(displayed),
    knowledgeSources: displayed.map(chunk => ({
      entryId: chunk.entryId, sourceId: chunk.sourceId, source: chunk.source, heading: chunk.heading,
      entryType: chunk.entryType, diagnosticEvidence: chunk.diagnosticEvidence,
      ...(chunk.generalEvidence ? { generalEvidence: true as const } : {}),
      evidenceKind: chunk.entryType === '通识学习' ? 'general-knowledge' as const : chunk.entryId ? 'archive' as const : 'prompt' as const,
      evidenceLabel: chunk.entryType === '通识学习' ? '通识（无手册页码）' : chunk.entryId ? `手册：${chunk.sourceTitle ?? chunk.sourceId ?? '来源待核实'}${chunk.pages?.pdf ? `，PDF第${chunk.pages.pdf}页` : ''}${chunk.pages?.printed ? `，印刷第${chunk.pages.printed}页` : ''}` : '信息收集提示（非手册）',
      locator: chunk.locator, version: chunk.version, applicability: chunk.applicability, status: chunk.status,
      ...(chunk.retrieval ? { retrieval: { ...chunk.retrieval, basis: [...chunk.retrieval.basis] } } : {}),
      referenceVerification: referenceVerification(chunk.status), sourceIndexed: hasIndexedReference(chunk),
      ...(chunk.sourceTitle ? { sourceTitle: chunk.sourceTitle } : {}), ...(chunk.scopeBoundary ? { scopeBoundary: chunk.scopeBoundary } : {}),
      ...(chunk.models ? { models: [...chunk.models] } : chunk.model ? { models: [chunk.model] } : {}),
      ...(chunk.engineModel ? { engineModel: chunk.engineModel } : {}), ...(chunk.faultCodes ? { faultCodes: [...chunk.faultCodes] } : {}),
      ...(chunk.pages ? { pages: { ...chunk.pages } } : {}), ...(chunk.roles ? { roles: [...chunk.roles], roleBasis: chunk.roleBasis } : {}),
      ...(chunk.riskLevel ? { riskLevel: chunk.riskLevel } : {}), usage: chunk.entryId && used.has(chunk.entryId) ? 'answer-evidence' : 'reference-only',
    })),
    diagnosisTrace: { retrievalCount: context.clarificationNeeded ? 0 : 1, aiAttempts: 0, aiSuccesses: 0, aiProvider: null,
      scoreMethod: 'keyword-weighted-overlap', contextChars: 0, sentKnowledgeIds: [],
      timings: { retrievalMs, decisionMs, externalAiMs: 0, totalMs: performance.now() - started } },
  };
}
function initialize() {
  if (ready) return;
  loadKnowledgeBase();
  loadKnowledgeCatalog();
  ready = true;
}
const json = (payload: unknown, status = 200) => Response.json(payload, { status });

/** Reuse the actual catalog and local RAG without sending preview traffic to production. */
async function dispatchPreviewFetch(input: string, options: RequestInit = {}): Promise<Response> {
  options.signal?.throwIfAborted();
  initialize();
  const url = new URL(input, 'https://dev-preview.invalid');
  const method = options.method?.toUpperCase() ?? 'GET';
  try {
    let response: Response;
    if (url.pathname === '/api/health' && method === 'GET') {
      response = json({
        ok: true,
        ...(typeof __AGRIDX_PREVIEW_RELEASE__ === 'undefined' ? {} : __AGRIDX_PREVIEW_RELEASE__),
        environment: 'development-preview', timestamp: new Date().toISOString(),
        knowledge: stats(), llm: { configured: false, primary: null },
        coordination: { defaultMode: 'knowledge_only', allowExternalAi: false, configValid: true },
      });
    } else if (url.pathname === '/api/knowledge/catalog' && method === 'GET') {
      const filters: CatalogFilters = {};
      for (const key of CATALOG_FILTER_KEYS) {
        const values = url.searchParams.getAll(key);
        if (values.length > 1 || (values.length && (!values[0].trim() || values[0].length > 100))) {
          return json({ error: '目录筛选须为非空文本（各上限100字符）', code: 'bad_request' }, 400);
        }
        if (values.length) {
          if (!validCatalogCondition(key, values[0].trim())) return json({ error: '配置或排放筛选值无效', code: 'bad_request' }, 400);
          Object.assign(filters, { [key]: values[0].trim() });
        }
      }
      if ((filters.model && !filters.brand) || (filters.component && !filters.model) || (filters.part && !filters.component)) {
        return json({ error: '请依次选择品牌、完整型号、组件和零部件', code: 'bad_request' }, 400);
      }
      response = json(getKnowledgeCatalog(filters));
    } else if (url.pathname.startsWith('/api/memory')) {
      const body = options.body ? JSON.parse(String(options.body)) : {};
      response = json(previewMemoryRoute(new PreviewMemoryStore(), url.pathname, method, body));
    } else if (url.pathname === '/api/chat' && method === 'POST') {
      let body: unknown;
      try { body = JSON.parse(String(options.body ?? '')); }
      catch { return json({ error: '请求体必须为有效的 JSON 对象', code: 'bad_request' }, 400); }
      const request = parseDiagnosticRequest(body);
      const started = performance.now();
      const question = { question: request.history.at(-1)!.content, machineType: request.machineType, brand: request.brand, model: request.model };
      try {
      // Preview enforces local-only even if the browser requests AI assistance.
      request.diagnosisMode = 'knowledge_only';
      const data = body as Record<string, unknown>;
      const store = data.sessionId === undefined ? undefined : new PreviewMemoryStore();
      const session = data.sessionId === undefined ? undefined : store!.session(String(data.sessionId));
      const user = request.history.at(-1)!;
      if (session) {
        if (session.revision !== data.revision) throw new MemoryError(409, 'memory_conflict', '诊断记录已更新，请重新载入后继续');
        for (const field of ['machineType', 'brand', 'model'] as const) {
          if (request[field] !== undefined && request[field] !== session.device[field]) throw new MemoryError(409, 'memory_device_changed', '请先保存设备档案或新建诊断');
          request[field] = session.device[field];
        }
        if (session.messages.length && /换一台|另一台|另外一台|现在换成/.test(user.content)) throw new MemoryError(409, 'memory_device_changed', '请为另一台设备新建诊断');
        if (session.messages.length) request.history = [...session.messages.map(({ role, content }) => ({ role, content })), user];
      }
      const priorReports = session ? store!.priorReports(session.deviceId, session.id, user.content) : [];
      const payload = await diagnose(request, session ? { session: { ...session, summary: summarizeReports(request.history) }, priorReports } : undefined);
      options.signal?.throwIfAborted();
      if (session) {
        const { model, provider, localSummary, coordinationMessage, answerMode, fallbackReason, knowledgeChunks,
          diagnosticReply, knowledgeSources, coordination, diagnosisTrace, roleFlow } = payload;
        payload.relatedMemoryReports = priorReports;
        payload.memory = store!.appendTurn(session.id, session.revision, user.content,
          { content: payload.choices[0].message.content, model, provider, localSummary, coordinationMessage, answerMode, fallbackReason, knowledgeChunks,
            diagnosticReply, knowledgeSources, coordination, diagnosisTrace, roleFlow },
          session.messages.length ? [] : request.history.slice(0, -1));
      }
      response = json(payload);
        recordQuestion({ ...question, machineType: request.machineType, brand: request.brand, model: request.model,
          outcome: 'success', knowledgeChunks: payload.knowledgeChunks, latencyMs: performance.now() - started });
      } catch (error) {
        recordQuestion({ ...question, outcome: options.signal?.aborted ? 'cancelled' : 'error', knowledgeChunks: 0, latencyMs: performance.now() - started });
        throw error;
      }
    } else {
      return json({ error: '接口不存在', code: 'not_found' }, 404);
    }
    options.signal?.throwIfAborted();
    return response;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof MemoryError) return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof DiagnosticInputError) return json({ error: error.message, code: error.code }, 400);
    if (error instanceof RangeError) return json({ error: error.message, code: 'knowledge_not_found' }, 404);
    throw error;
  }
}

/** Serialize memory changes across tabs so late replies cannot revive a cleared record. */
export async function previewFetch(input: string, options: RequestInit = {}): Promise<Response> {
  if (typeof navigator !== 'undefined' && navigator.locks && (input.startsWith('/api/memory') || input === '/api/chat')) {
    return navigator.locks.request('agridx-preview-memory', { signal: options.signal ?? undefined }, () => dispatchPreviewFetch(input, options));
  }
  return dispatchPreviewFetch(input, options);
}
