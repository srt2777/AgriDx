import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { createApp } from '../server/app';
import { TelemetryRuntime } from '../server/telemetry/runtime';
import { loadTelemetryDemoConfig } from '../server/telemetry/simulator';
import { TELEMETRY_WATERMARK, type TelemetryFrame, type TelemetryHistory } from '../shared/telemetry';

async function fixture(t: TestContext, enabled = true, capacity = 20) {
  const config = loadTelemetryDemoConfig(); config.capacity = capacity; config.heartbeatMs = 1000;
  let now = Date.UTC(2026, 9, 25);
  const runtime = new TelemetryRuntime(config, { now: () => now, automatic: false, runId: 'http-test' });
  const app = createApp({ rootDirectory: process.cwd(), version: 'telemetry-test', telemetry: enabled ? runtime : undefined,
    diagnose: async () => { throw new Error('telemetry must not call diagnosis'); },
    getCatalog: () => { throw new Error('telemetry must not call knowledge'); },
    getKnowledgeStats: () => { throw new Error('telemetry must not call stats'); },
    getLlmStatus: () => { throw new Error('telemetry must not call providers'); },
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  // Express removes its /api mount prefix while a streaming handler is active.
  const closed = new EventEmitter(); server.on('request', (req, res) => { if (req.url?.endsWith('/stream')) res.on('close', () => closed.emit('closed')); });
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const controllers: AbortController[] = [];
  t.after(async () => {
    controllers.forEach(control => control.abort()); runtime.close(); server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  async function stream(cursor?: string) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/telemetry/stream`, { headers: cursor ? { 'Last-Event-ID': cursor } : {}, signal: controller.signal });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let buffer = '';
    const pending: { event: string; id?: string; data: unknown }[] = [];
    async function next(expected: string) {
      for (;;) {
        const index = pending.findIndex(item => item.event === expected);
        if (index >= 0) return pending.splice(index, 1)[0];
        const result = await reader.read(); assert.equal(result.done, false, `stream ended before ${expected}`);
        buffer += decoder.decode(result.value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) pending.push({ event, id: /^id: (.+)$/m.exec(block)?.[1], data: JSON.parse(data) });
        }
      }
    }
    return { response, next, close: () => { void reader.cancel().catch(() => {}); controller.abort(); } };
  }
  return { base, runtime, stream, closed, advance(ms: number) { now += ms; runtime.tick(); } };
}

test('history returns scoped simulated points and a watermark without contacting diagnosis, knowledge or stats', async t => {
  const f = await fixture(t); f.advance(5000);
  const response = await fetch(`${f.base}/api/telemetry/history?channel=diesel.engine.rpm&window=5m`);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const history = await response.json() as TelemetryHistory;
  assert.equal(history.source, 'simulated'); assert.equal(history.watermark, TELEMETRY_WATERMARK);
  assert.equal(history.points.length, 6); assert.equal(history.channel.threshold, null);
  assert.ok(history.points.every(point => point.channelId === history.channel.id && point.source === 'simulated' && point.deviceId === history.channel.deviceId));
  assert.deepEqual(history.points.at(-1), f.runtime.replay(null).frames[0].points.find(point => point.channelId === history.channel.id));
});

test('history validates scalar channel/window and rejects unknown query fields, while ingest remains absent', async t => {
  const { base } = await fixture(t);
  for (const query of ['', 'channel=', 'channel=../secret', 'channel=diesel.engine.rpm&channel=t70.gps.status',
    'channel=diesel.engine.rpm&window=', 'channel=diesel.engine.rpm&window=day', 'channel=diesel.engine.rpm&window=__proto__',
    'channel=diesel.engine.rpm&window=5m&window=1h', 'channel=diesel.engine.rpm&source=device']) {
    const response = await fetch(`${base}/api/telemetry/history?${query}`); assert.equal(response.status, 400, query);
  }
  assert.equal((await fetch(`${base}/api/telemetry/history?channel=unknown`)).status, 404);
  for (const window of ['5m', '15m', '1h']) assert.equal((await fetch(`${base}/api/telemetry/history?channel=t70.gps.status&window=${window}`)).status, 200);
  const noWindow = await fetch(`${base}/api/telemetry/history?channel=t70.gps.status`); assert.equal((await noWindow.json()).window, '5m');
  const ingest = await fetch(`${base}/api/telemetry/ingest`, { method: 'POST' }); assert.equal(ingest.status, 404);
  const head = await fetch(`${base}/api/telemetry/stream`, { method: 'HEAD' });
  assert.equal(head.status, 405); assert.equal(head.headers.get('allow'), 'GET');
});

test('SSE has catalogue/retry/IDs, shares live frames across clients and replays a disconnected cursor', { timeout: 8000 }, async t => {
  const f = await fixture(t);
  const first = await f.stream();
  assert.equal(first.response.headers.get('x-accel-buffering'), 'no');
  assert.match(first.response.headers.get('cache-control')!, /no-transform/);
  const catalogue = await first.next('catalog'); assert.equal((catalogue.data as { watermark: string }).watermark, TELEMETRY_WATERMARK);
  const start = await first.next('telemetry'); assert.equal(start.id, 'http-test:1'); first.close();
  f.advance(5000);
  const resumed = await f.stream(start.id); await resumed.next('catalog');
  for (const sequence of [2, 3, 4, 5, 6]) assert.equal((await resumed.next('telemetry')).id, `http-test:${sequence}`);
  const second = await f.stream(); await second.next('catalog'); await second.next('telemetry');
  f.advance(1000);
  const a = await resumed.next('telemetry'), b = await second.next('telemetry');
  assert.deepEqual(a, b); assert.equal(a.id, 'http-test:7');
  const frame = a.data as TelemetryFrame; assert.equal(frame.source, 'simulated'); assert.equal(frame.watermark, TELEMETRY_WATERMARK);
  assert.ok(frame.points.every(point => point.source === 'simulated'));
});

test('SSE resets expired, restarted or ahead cursors and rejects malformed cursors before opening a stream', { timeout: 8000 }, async t => {
  const f = await fixture(t, true, 4); f.advance(10000);
  for (const [cursor, reason] of [['http-test:1', 'history_expired'], ['old-run:1', 'server_restart'], ['http-test:999', 'cursor_ahead']]) {
    const stream = await f.stream(cursor); await stream.next('catalog');
    const reset = (await stream.next('reset')).data as { reason: string; watermark: string };
    assert.equal(reset.reason, reason); assert.equal(reset.watermark, TELEMETRY_WATERMARK);
    const frame = await stream.next('telemetry'); assert.equal(frame.id, 'http-test:11');
    stream.close();
  }
  for (const cursor of ['bad', 'http-test:0', 'x:9007199254740992', 'x'.repeat(100)]) {
    assert.equal((await fetch(`${f.base}/api/telemetry/stream`, { headers: { 'Last-Event-ID': cursor } })).status, 400);
  }
  assert.equal((await fetch(`${f.base}/api/telemetry/stream?source=device`)).status, 400);
});

test('SSE heartbeat carries simulation provenance without advancing measurement sequence or cursor', { timeout: 5000 }, async t => {
  const f = await fixture(t); const stream = await f.stream(); await stream.next('catalog'); await stream.next('telemetry');
  const heartbeat = await stream.next('heartbeat');
  assert.equal(heartbeat.id, undefined); assert.equal((heartbeat.data as { source: string }).source, 'simulated');
  assert.equal((heartbeat.data as { watermark: string }).watermark, TELEMETRY_WATERMARK);
  assert.deepEqual(f.runtime.replay({ runId: 'http-test', sequence: 1 }).frames, []);
});

test('disconnect releases per-IP connection slots; excessive connections and requests are bounded', { timeout: 8000 }, async t => {
  const f = await fixture(t); const streams = [];
  for (let i = 0; i < 4; i++) streams.push(await f.stream());
  const fifth = await fetch(`${f.base}/api/telemetry/stream`); assert.equal(fifth.status, 429); assert.equal((await fifth.json()).code, 'telemetry_connection_limit');
  const closed = once(f.closed, 'closed'); streams[0].close(); await closed;
  const replacement = await f.stream(); await replacement.next('catalog'); replacement.close();
  for (let i = 0; i < 24; i++) assert.equal((await fetch(`${f.base}/api/telemetry/history?channel=diesel.engine.rpm`)).status, 200);
  const limited = await fetch(`${f.base}/api/telemetry/history?channel=diesel.engine.rpm`); assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'rate_limited');
});

test('off mode is explicit and unexpected history failures use existing redacted errors', async t => {
  const off = await fixture(t, false);
  for (const path of ['history?channel=diesel.engine.rpm', 'stream']) {
    const response = await fetch(`${off.base}/api/telemetry/${path}`); assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'telemetry_disabled');
  }
  const on = await fixture(t); t.mock.method(console, 'error', () => {});
  on.runtime.history = () => { throw new Error('private-token-and-server-path'); };
  const response = await fetch(`${on.base}/api/telemetry/history?channel=diesel.engine.rpm`);
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: '服务器内部错误' });
  on.runtime.replay = () => { throw new Error('private-stream-path'); };
  const streamFailure = await fetch(`${on.base}/api/telemetry/stream`);
  assert.equal(streamFailure.status, 500); assert.deepEqual(await streamFailure.json(), { error: '服务器内部错误' });
});
