import { json, Router, type ErrorRequestHandler } from 'express';
import { TELEMETRY_WATERMARK, TELEMETRY_WINDOWS, type TelemetryHeartbeat, type TelemetryScenarioCommand, type TelemetryWindow } from '../../shared/telemetry';
import { createChatRateLimiter } from '../http/middleware';
import { parseTelemetryCursor, TelemetryScenarioConflict, type TelemetryRuntime } from '../telemetry/runtime';
import { createTelemetrySseWriter } from '../telemetry/sse';

export function createTelemetryRoutes(runtime: TelemetryRuntime | undefined): Router {
  const router = Router();
  router.use('/telemetry', createChatRateLimiter());
  const active = new Map<string, number>();
  let connections = 0;
  router.get('/telemetry/scenario', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!runtime) { res.status(503).json({ code: 'telemetry_disabled', error: '仿真监测已关闭' }); return; }
    if (Object.keys(req.query).length) { res.status(400).json({ code: 'bad_request', error: '场景读取不接受查询参数' }); return; }
    res.json(runtime.scenario());
  });
  router.post('/telemetry/scenario', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Match existing same-origin mutation policy, with a telemetry-specific error and no memory ownership.
    try {
      if (req.get('sec-fetch-site') === 'cross-site' || (req.headers.origin
        && new URL(req.headers.origin).origin !== new URL(`${req.protocol}://${req.get('host')}`).origin)) throw new Error('origin');
    } catch { res.status(403).json({ code: 'telemetry_origin', error: '请从本站操作仿真场景' }); return; }
    if (!runtime) { res.status(503).json({ code: 'telemetry_disabled', error: '仿真监测已关闭' }); return; }
    if (!req.is('application/json')) { res.status(415).json({ code: 'unsupported_media_type', error: '场景命令须使用JSON' }); return; }
    next();
  }, json({ limit: '1kb' }), (req, res) => {
    const body: unknown = req.body;
    if (Object.keys(req.query).length || !body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 4 || Object.keys(body).some(key => !['expectedRunId', 'revision', 'id', 'loop'].includes(key))) {
      res.status(400).json({ code: 'bad_request', error: '请提供完整的仿真场景命令' }); return;
    }
    const command = body as TelemetryScenarioCommand;
    if (typeof command.expectedRunId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(command.expectedRunId)
      || !Number.isSafeInteger(command.revision) || command.revision < 0 || typeof command.loop !== 'boolean'
      || !runtime!.catalog().scenarios.some(item => item.id === command.id)) {
      res.status(400).json({ code: 'bad_request', error: '仿真场景、循环标记或版本无效' }); return;
    }
    try { res.json(runtime!.changeScenario(command)); }
    catch (error) {
      if (!(error instanceof TelemetryScenarioConflict)) throw error;
      res.status(409).json({ code: 'telemetry_scenario_conflict', error: '仿真场景已变化，请重新读取后再试', state: runtime!.scenario() });
    }
  });
  router.get('/telemetry/history', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!runtime) { res.status(503).json({ code: 'telemetry_disabled', error: '仿真监测已关闭' }); return; }
    const channel = req.query.channel, window = req.query.window ?? '5m';
    if (Object.keys(req.query).some(key => !['channel', 'window'].includes(key)) || typeof channel !== 'string'
      || !/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(channel) || typeof window !== 'string' || !Object.hasOwn(TELEMETRY_WINDOWS, window)) {
      res.status(400).json({ code: 'bad_request', error: '请提供有效通道和时间窗（5m、15m、1h）' }); return;
    }
    if (!runtime.channel(channel)) { res.status(404).json({ code: 'telemetry_channel_not_found', error: '监测通道不存在' }); return; }
    res.json(runtime.history(channel, window as TelemetryWindow));
  });
  // Express otherwise dispatches HEAD to GET and would retain a bodyless SSE connection.
  router.head('/telemetry/stream', (_req, res) => { res.status(405).set('Allow', 'GET').end(); });
  router.get('/telemetry/stream', (req, res) => {
    if (!runtime) { res.status(503).json({ code: 'telemetry_disabled', error: '仿真监测已关闭' }); return; }
    let cursor;
    try { cursor = parseTelemetryCursor(req.get('Last-Event-ID')); }
    catch { res.status(400).json({ code: 'bad_request', error: '监测重连游标无效' }); return; }
    if (Object.keys(req.query).length > 0) { res.status(400).json({ code: 'bad_request', error: '监测流不接受查询参数' }); return; }
    const ip = req.ip || 'unknown';
    if (connections >= 32 || (active.get(ip) ?? 0) >= 4) {
      res.status(429).json({ code: 'telemetry_connection_limit', error: '监测连接过多，请关闭其他监测窗口后重试' }); return;
    }
    const replay = runtime.replay(cursor), catalog = runtime.catalog();
    connections++; active.set(ip, (active.get(ip) ?? 0) + 1);
    const timers: { heartbeat?: ReturnType<typeof setInterval> } = {};
    let unsubscribe = () => {};
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (timers.heartbeat) clearInterval(timers.heartbeat);
      unsubscribe();
      res.off('close', cleanup); res.off('error', cleanup);
      const remaining = (active.get(ip) ?? 1) - 1;
      if (remaining > 0) active.set(ip, remaining); else active.delete(ip);
      connections--;
      writer.close();
    };
    const writer: ReturnType<typeof createTelemetrySseWriter> = createTelemetrySseWriter(res, cleanup);
    res.on('close', cleanup); res.on('error', cleanup);
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    if (!writer.send('catalog', catalog)) return;
    if (replay.reset && !writer.send('reset', { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK,
      runId: runtime.runId, reason: replay.reset })) return;
    for (const frame of replay.frames) if (!writer.send('telemetry', frame, `${frame.runId}:${frame.sequence}`)) return;
    try { unsubscribe = runtime.subscribe(frame => { writer?.send('telemetry', frame, `${frame.runId}:${frame.sequence}`); }); }
    catch { writer.close(); return; }
    if (closed) { unsubscribe(); return; }
    timers.heartbeat = setInterval(() => {
      const payload: TelemetryHeartbeat = { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, at: Date.now() };
      writer?.send('heartbeat', payload);
    }, catalog.heartbeatMs);
    timers.heartbeat.unref();
  });
  const controlBodyError: ErrorRequestHandler = (error, _req, res, next) => {
    if (error.type === 'entity.too.large') { res.status(413).json({ code: 'telemetry_control_too_large', error: '仿真场景命令体积过大' }); return; }
    next(error);
  };
  router.use(controlBodyError);
  return router;
}
