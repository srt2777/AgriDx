import { Router } from 'express';
import { sameOrigin } from '../memory/routes';
import { createChatRateLimiter } from '../http/middleware';
import { WorkflowInputError, type Workflow } from '../../agent/core/workflow';

/** Optional composition, disabled unless the trusted startup creates a workflow. Never exposes arbitrary tools or confirmation flags. */
export function createAgentRoutes(workflow?: Workflow): Router {
  const router = Router(); let active = 0;
  router.get('/status', (_req, res) => { res.set('Cache-Control', 'no-store').json({ enabled: !!workflow, provider: workflow ? 'local-rule' : null, capabilities: workflow ? ['strict-reference-search', 'fault-code-exact', 'clarification', 'execution-events'] : [] }); });
  router.post('/run', createChatRateLimiter(), sameOrigin, async (req, res) => {
    if (!workflow) { res.status(404).json({ code: 'agent_disabled', error: 'Agent 资料定位未启用' }); return; }
    if (active >= 2) { res.status(429).json({ code: 'agent_busy', error: '服务繁忙，请稍后重试' }); return; }
    active++;
    const controller = new AbortController();
    const close = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', close);
    try {
      const stream = req.accepts(['json', 'text/event-stream']) === 'text/event-stream';
      // Headers are sent only after the validated workflow emits its first event.
      const onEvent = stream ? (event: unknown) => {
        if (controller.signal.aborted || res.destroyed) return;
        if (!res.headersSent) { res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); res.flushHeaders(); }
        res.write(`event: status\ndata: ${JSON.stringify(event)}\n\n`);
      } : undefined;
      const result = await workflow.run(req.body, { signal: controller.signal, onEvent });
      if (res.destroyed) return;
      if (stream) {
        if (!res.headersSent) res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        res.write(`event: final\ndata: ${JSON.stringify(result)}\n\n`); res.end();
      } else res.set('Cache-Control', 'no-store').json(result);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof WorkflowInputError) res.status(400).json({ code: 'bad_request', error: error.message });
      else res.status(503).json({ code: 'agent_unavailable', error: '诊断资料定位暂不可用' });
    } finally { active--; res.off('close', close); }
  });
  return router;
}
