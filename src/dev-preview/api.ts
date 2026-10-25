/// <reference types="node" />
import { createDiagnosticService } from '../../server/diagnosis/service';
import { previewAiProvider, readPreviewAiStatus } from './ai-gateway';
import { recordQuestion } from './telemetry';
import { PreviewMemoryStore, previewMemoryRoute } from './memory';
import { MemoryError, summarizeReports } from '../../shared/memory-validation';
import { loadKnowledgeBase, stats } from '../../server/knowledge/retriever';
import { getKnowledgeCatalog, loadKnowledgeCatalog } from '../../server/knowledge/catalog';
import { renderDiagnosticReply } from '../../server/diagnosis/reply';
import { DiagnosticInputError, parseDiagnosticRequest, type DiagnosticRequest } from '../../server/diagnosis/request';
import type { ChatResponse } from '../../shared/chat';
import type { SessionDetail, PriorDeviceReport } from '../../shared/memory';
import { CATALOG_FILTER_KEYS, validCatalogCondition, type CatalogFilters } from '../../shared/knowledge-catalog';

let ready = false;
/** Reuse canonical retrieval, coordination and output checks with a same-origin AI proxy. */
async function diagnose(request: DiagnosticRequest, memory?: { session: SessionDetail; priorReports: PriorDeviceReport[] }, signal?: AbortSignal): Promise<ChatResponse> {
  const status = await readPreviewAiStatus(signal);
  const service = createDiagnosticService(previewAiProvider(status, signal), { config: { logDecisions: false } });
  const payload = await service(status.enabled ? request : { ...request, diagnosisMode: 'knowledge_only' }, memory);
  signal?.throwIfAborted();
  if (!status.enabled && payload.diagnosticReply) {
    payload.diagnosticReply.understanding += '当前为仅本地检索的开发预览，本次没有调用外部 AI。';
    const content = renderDiagnosticReply(payload.diagnosticReply);
    payload.choices[0].message.content = content;
    payload.localSummary = content;
  }
  return payload;
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
      const aiStatus = await readPreviewAiStatus(options.signal ?? undefined);
      response = json({
        ok: true,
        ...(typeof __AGRIDX_PREVIEW_RELEASE__ === 'undefined' ? {} : __AGRIDX_PREVIEW_RELEASE__),
        environment: 'development-preview', timestamp: new Date().toISOString(),
        knowledge: stats(), llm: { configured: aiStatus.enabled, primary: aiStatus.provider },
        coordination: { defaultMode: aiStatus.enabled ? 'auto' : 'knowledge_only', allowExternalAi: aiStatus.enabled, configValid: true },
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
      const payload = await diagnose(request, session ? { session: { ...session, summary: summarizeReports(request.history) }, priorReports } : undefined, options.signal ?? undefined);
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
