import { Router } from 'express';
import { createHash } from 'node:crypto';
import { DiagnosticInputError, parseDiagnosticRequest } from '../diagnosis/request';
import { PLANNER_COMMIT, type DiagnosticService, type DiagnosticMemory } from '../diagnosis/service';
import { getMemoryStore, MemoryError, summarizeReports, validId } from '../memory/store';
import { memoryFailure, memoryOwner, revisionFrom, sameOrigin } from '../memory/routes';
import type { MemoryMessage, SessionDetail } from '../../shared/memory';

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
      const memory: DiagnosticMemory | undefined = remembered ? { session: { ...remembered, summary: summarizeReports(input.history) }, priorReports, plannerCheckpoint: store().plannerCheckpoint(owner, remembered.id),
        plannerSessionSeed: createHash('sha256').update(remembered.id).digest('hex').slice(0, 32) } : undefined;
      const payload = await diagnose(input, memory, controller.signal);
      if (res.destroyed) return;
      if (remembered) {
        const assistant: Omit<MemoryMessage, 'id' | 'role' | 'createdAt'> = { content: payload.choices[0].message.content };
        for (const field of ['model', 'provider', 'localSummary', 'coordinationMessage', 'answerMode', 'fallbackReason', 'knowledgeChunks', 'diagnosticReply', 'knowledgeSources', 'coordination', 'diagnosisTrace', 'roleFlow'] as const) {
          if (payload[field] !== undefined) Object.assign(assistant, { [field]: payload[field] });
        }
        payload.memory = store().appendTurn(owner, remembered.id, remembered.revision, user.content, assistant, remembered.messages.length ? [] : input.history.slice(0, -1), payload[PLANNER_COMMIT]);
        payload.relatedMemoryReports = priorReports;
      }
      res.json(payload);
    } catch (error) {
      if (error instanceof DiagnosticInputError) { res.status(400).json({ error: error.message, code: error.code }); return; }
      if (error instanceof MemoryError || remembered || req.body?.sessionId !== undefined) { memoryFailure(error, res); return; }
      console.error('[chat] unexpected error:', error);
      res.status(502).json({ error: '智能诊断服务暂时无法连接，请稍后重试。', code: 'llm_unavailable' });
    } finally { req.off('aborted',disconnect);res.off('close',disconnect);if (acquired && remembered) active.delete(remembered.id); }
  });
  return router;
}
