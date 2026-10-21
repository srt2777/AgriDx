import { Router, json, type ErrorRequestHandler } from 'express';

/** The only upstream is an operator-configured private img2threejs worker. */
export function createModelingRoutes() {
  const router = Router();
  const submissions = new Map<string, number>();
  const inFlight = new Set<string>();
  function config() {
    const base = process.env.IMG2THREEJS_SERVICE_URL?.trim();
    const key = process.env.IMG2THREEJS_SERVICE_TOKEN?.trim();
    if (!base || !key) return null;
    try {
      const url = new URL(base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
      return { base: url.href.replace(/\/$/, ''), key };
    } catch { return null; }
  }
  async function upstream(path: string, method = 'GET', body?: unknown) {
    const settings = config();
    if (!settings) throw new Error('not_configured');
    return fetch(`${settings.base}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${settings.key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/capabilities', async (_req, res) => {
    let available = false;
    if (config()) {
      try { const response = await upstream('/health'); const body = await response.json() as { ready?: unknown }; available = response.ok && body?.ready === true; } catch { /* Keep unavailable honest. */ }
    }
    res.json({ available, engine: 'img2threejs', message: available ? '建模服务已就绪。' : 'img2threejs 建模进程尚未就绪，请联系管理员配置。' });
  });
  router.post('/jobs', json({ limit: '12mb' }), async (req, res) => {
    if (!config()) { res.status(503).json({ error: 'img2threejs 建模服务尚未配置。' }); return; }
    // Bound public inference costs. Do not retain IPs after the one-hour window.
    const now = Date.now();
    for (const [ip, until] of submissions) if (until <= now) submissions.delete(ip);
    const ip = req.ip ?? 'unknown';
    if (submissions.has(ip) || inFlight.has(ip) || submissions.size + inFlight.size >= 1000) { res.status(429).json({ error: '请稍后再提交建模任务（每小时一次）。' }); return; }
    inFlight.add(ip);
    try {
      const response = await upstream('/jobs', 'POST', req.body);
      if (response.ok) submissions.set(ip, now + 60 * 60 * 1000);
      res.status(response.status).json(await response.json());
    } catch { res.status(503).json({ error: '暂时无法连接 img2threejs 建模进程。' }); }
    finally { inFlight.delete(ip); }
  });
  router.get('/jobs/:id', async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id)) { res.status(404).json({ error: '任务不存在。' }); return; }
    try { const response = await upstream(`/jobs/${req.params.id}`); res.status(response.status).json(await response.json()); }
    catch { res.status(503).json({ error: '暂时无法查询建模任务。' }); }
  });
  router.get('/jobs/:id/:artifact', async (req, res) => {
    const artifact = req.params.artifact;
    if (!/^[a-f0-9]{64}$/.test(req.params.id) || !['model.glb', 'source.ts', 'spec.json', 'review.json'].includes(artifact)) {
      res.status(404).json({ error: '文件不存在。' }); return;
    }
    try {
      const response = await upstream(`/jobs/${req.params.id}/${artifact}`);
      if (!response.ok) { res.status(response.status).json({ error: '结果尚不可用或已过期。' }); return; }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 25 * 1024 * 1024) throw new Error('oversized');
      res.setHeader('Content-Type', artifact === 'model.glb' ? 'model/gltf-binary' : 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="img2threejs-${artifact}"`);
      res.send(bytes);
    } catch { res.status(503).json({ error: '暂时无法下载生成结果。' }); }
  });
  const bodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (error.type === 'entity.too.large') { res.status(413).json({ error: '图片总量超过上传限制。' }); return; }
    if (error.type === 'entity.parse.failed') { res.status(400).json({ error: '图片请求格式无效。' }); return; }
    next(error);
  };
  router.use(bodyError);
  return router;
}
