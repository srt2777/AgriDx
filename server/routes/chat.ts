import { Router } from 'express';
import { createHash } from 'node:crypto';
import { DiagnosticInputError, parseDiagnosticRequest } from '../diagnosis/request';
import { PLANNER_COMMIT, type DiagnosticService, type DiagnosticMemory } from '../diagnosis/service';
import { getMemoryStore, MemoryError, summarizeReports, validId } from '../memory/store';
import { memoryErrorPayload, memoryFailure, memoryOwner, revisionFrom, sameOrigin } from '../memory/routes';
import { createSseWriter } from '../telemetry/sse';
import type { MemoryMessage, SessionDetail } from '../../shared/memory';

/**
 * POST /api/chat — JSON by default. When the client sends
 * `Accept: text/event-stream`, the same diagnosis runs and the answer
 * streams as SSE instead:
 *   event: delta, data: {"text": "..."}   AI supplement chunks, in order
 *   event: done,  data: <the full JSON envelope, identical to the JSON path>
 *   event: error, data: {"error": "...", "code": "..."}  only if the turn fails after streaming started
 * Deltas are the raw AI supplement before the answer guard runs, so they
 * are a provisional preview: the `done` envelope (guard-filtered,
 * rendered, with memory/coordination metadata) is authoritative and the
 * client must replace the preview with it. Clients that do not ask for
 * SSE (including the robot firmware) get exactly today's JSON response.
 */
export function createChatRoutes(diagnose: DiagnosticService, store = getMemoryStore): Router {
  const router = Router();
  const active = new Set<string>();
  router.post('/chat', sameOrigin, async (req, res) => {
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    req.on('aborted', disconnect);
    res.on('close', disconnect);
    let remembered: SessionDetail | undefined;
    let owner = '';
    let acquired = false;
    // Set only once streaming starts (after validation, just before the
    // diagnosis runs): errors before this point still use the JSON error
    // responses below, because no SSE headers have been sent yet.
    let writer: ReturnType<typeof createSseWriter> | undefined;
    try {
      const input = parseDiagnosticRequest(req.body);
      const user = input.history.at(-1)!;
      if (req.body.sessionId !== undefined) {
        if (!validId(req.body.sessionId)) throw new MemoryError(400, 'bad_request', '诊断记录编号格式错误');
        const revision = revisionFrom(req.body.revision);
        owner = memoryOwner(req, res);
        remembered = store().session(owner, req.body.sessionId);
        if (remembered.revision !== revision) throw new MemoryError(409, 'memory_conflict', '诊断记录已更新，请重新载入后继续');
        if (active.has(remembered.id)) throw new MemoryError(409, 'memory_busy', '本次诊断正在回答，请等待后再继续');
        if (remembered.messages.length >= 2000) throw new MemoryError(409, 'memory_limit', '本次诊断记录已达上限，请新建诊断');
        if (remembered.messages.length && /换一台|另一台|另外一台|现在换成/.test(user.content)) {
          throw new MemoryError(409, 'memory_device_changed', '诊断另一台设备时，请选择或新建设备档案并新建诊断，避免混用检查结果');
        }
        for (const field of ['machineType', 'brand', 'model'] as const) {
          if (input[field] !== undefined && input[field] !== remembered.device[field]) {
            throw new MemoryError(409, 'memory_device_changed', '设备信息已改变，请先保存设备档案或为另一台设备新建诊断');
          }
          input[field] = remembered.device[field];
        }
        if (remembered.messages.length) input.history = [...remembered.messages.map(({ role, content }) => ({ role, content })), user];
        active.add(remembered.id); acquired = true;
        res.set('Cache-Control', 'no-store');
      }
      const priorReports = remembered ? store().priorReports(owner, remembered.deviceId, remembered.id, user.content) : [];
      const memory: DiagnosticMemory | undefined = remembered ? { session: { ...remembered, summary: summarizeReports(input.history) }, priorReports, longTerm: store().longTerm(owner, remembered.deviceId), plannerCheckpoint: store().plannerCheckpoint(owner, remembered.id),
        plannerSessionSeed: createHash('sha256').update(remembered.id).digest('hex').slice(0, 32) } : undefined;
      const streaming = (req.get('Accept') ?? '').includes('text/event-stream');
      if (streaming) {
        res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        writer = createSseWriter(res, () => {});
      }
      const payload = await diagnose(input, memory, controller.signal,
        writer ? (text) => { writer!.send('delta', { text }); } : undefined);
      if (controller.signal.aborted || res.destroyed) { console.warn('[chat] response skipped: client disconnected'); return; }
      if (remembered) {
        const assistant: Omit<MemoryMessage, 'id' | 'role' | 'createdAt'> = { content: payload.choices[0].message.content };
        for (const field of ['model', 'provider', 'localSummary', 'coordinationMessage', 'answerMode', 'fallbackReason', 'knowledgeChunks', 'diagnosticReply', 'knowledgeSources', 'coordination', 'diagnosisTrace', 'roleFlow'] as const) {
          if (payload[field] !== undefined) Object.assign(assistant, { [field]: payload[field] });
        }
        // The answer is already generated at this point, so a transient
        // storage failure must not discard it (previously this threw and
        // the whole turn came back as a memory error). Retry once, then
        // return the answer flagged; the client keeps its old revision, so
        // the next turn can retry against the last saved revision, and the
        // un-saved turn's planner commit is not persisted either.
        // Deterministic MemoryErrors are NOT degraded: a revision conflict
        // (clear/delete/concurrent save), a record limit, or an invalid
        // commit must still surface as an error, so a cleared or deleted
        // diagnosis is never silently revived by a late answer.
        let saved = false;
        let lastAppendError: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          // The client may disconnect during the asynchronous retry delay.
          if (controller.signal.aborted || res.destroyed) return;
          try {
            payload.memory = store().appendTurn(owner, remembered.id, remembered.revision, user.content, assistant, remembered.messages.length ? [] : input.history.slice(0, -1), payload[PLANNER_COMMIT]);
            saved = true; break;
          } catch (error) {
            if (error instanceof MemoryError) throw error;
            lastAppendError = error;
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        if (!saved) {
          console.error('[chat] memory append failed after diagnosis; returning answer without saving:', lastAppendError);
          payload.memorySaveFailed = true;
        }
        payload.relatedMemoryReports = priorReports;
      }
      if (writer) {
        if (!writer.closed) writer.send('done', payload);
        writer.close();
        return;
      }
      res.json(payload);
    } catch (error) {
      // The client is gone; writing a status body to a dead connection is
      // pointless and must not mask the disconnect in logs or error counts.
      if (res.destroyed) return;
      // SSE headers are already sent: the error has to travel as an SSE
      // event with the same payload the JSON path would have returned.
      if (writer && res.headersSent) {
        if (error instanceof DiagnosticInputError) writer.send('error', { error: error.message, code: error.code });
        else if (error instanceof MemoryError || remembered || req.body?.sessionId !== undefined) {
          const payload = memoryErrorPayload(error);
          writer.send('error', { error: payload.error, code: payload.code });
        } else {
          console.error('[chat] unexpected error:', error);
          writer.send('error', { error: '智能诊断服务暂时无法连接，请稍后重试。', code: 'llm_unavailable' });
        }
        writer.close();
        return;
      }
      if (error instanceof DiagnosticInputError) { res.status(400).json({ error: error.message, code: error.code }); return; }
      if (error instanceof MemoryError || remembered || req.body?.sessionId !== undefined) { memoryFailure(error, res); return; }
      console.error('[chat] unexpected error:', error);
      res.status(502).json({ error: '智能诊断服务暂时无法连接，请稍后重试。', code: 'llm_unavailable' });
    } finally { req.off('aborted',disconnect);res.off('close',disconnect);if (acquired && remembered) active.delete(remembered.id); }
  });
  return router;
}
