import { coordinationConfig } from '../knowledge/coordination';
import { Router } from 'express';
import path from 'node:path';
import type { ServerRuntime } from '../runtime';

export function createStatusRoutes(runtime: ServerRuntime): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      ok: true, version: runtime.version, timestamp: new Date().toISOString(),
      coordination: coordinationConfig(),
      knowledge: runtime.getKnowledgeStats(), llm: runtime.getLlmStatus(),
    });
  });
  router.get('/model/tractor', (_req, res, next) => {
    res.sendFile(path.resolve(runtime.rootDirectory, 'ui/public/models/tractor-detailed-v1.glb'), (error) => {
      if (!error) return;
      if (res.headersSent) return next(error);
      res.status(404).json({ error: '模型文件不存在' });
    });
  });
  return router;
}
