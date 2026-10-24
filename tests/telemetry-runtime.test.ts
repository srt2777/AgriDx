import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import { telemetryConnectionState, type TelemetryFrame } from '../shared/telemetry';
import { loadTelemetryDemoConfig } from '../server/telemetry/simulator';
import { parseTelemetryCursor, TelemetryRing, TelemetryRuntime, telemetryFromEnvironment } from '../server/telemetry/runtime';
import { createTelemetrySseWriter } from '../server/telemetry/sse';

function fixture(capacity = 4) {
  const config = loadTelemetryDemoConfig(); config.capacity = capacity;
  let clock = 100000;
  const runtime = new TelemetryRuntime(config, { now: () => clock, runId: 'test-run', automatic: false });
  return { runtime, advance(ms: number) { clock += ms; runtime.tick(); } };
}

test('ring retains exactly its capacity in order, owns copies, and rejects mixed/repeated frames', () => {
  const { runtime, advance } = fixture();
  const ring = new TelemetryRing(3);
  const first = runtime.replay(null).frames[0]; ring.push(first);
  first.points[0].value = -999;
  for (let step = 0; step < 7; step++) { advance(1000); ring.push(runtime.replay(null).frames[0]); }
  assert.equal(ring.size, 3); assert.equal(ring.oldestSequence, 6); assert.equal(ring.newestSequence, 8);
  assert.deepEqual(ring.since(0).map(frame => frame.sequence), [6, 7, 8]);
  const copy = ring.latest()!; copy.points[0].value = -999;
  assert.notEqual(ring.latest()!.points[0].value, -999);
  assert.throws(() => ring.push(copy), /Non-monotonic/);
  assert.throws(() => ring.push({ ...copy, sequence: 9, runId: 'another-run' }), /Non-monotonic/);
  for (const capacity of [0, 1, 3601, NaN, 2.1]) assert.throws(() => new TelemetryRing(capacity), RangeError);
  runtime.close();
});

test('history and replay share one producer, cap catch-up, preserve copies and filter windows', () => {
  const { runtime, advance } = fixture(3600);
  const channel = runtime.catalog().channels[0];
  const initial = runtime.history(channel.id, '5m'); assert.equal(initial.points.length, 1);
  advance(7200000);
  const hour = runtime.history(channel.id, '1h'), short = runtime.history(channel.id, '5m');
  assert.equal(hour.points.length, 3600); assert.equal(short.points.length, 301);
  assert.equal(hour.points.at(-1)!.at, short.to);
  assert.ok(short.points.every(point => point.at >= short.from && point.at <= short.to));
  const latest = runtime.replay(null).frames[0];
  assert.deepEqual(latest.points.find(point => point.channelId === channel.id), short.points.at(-1));
  short.points[0].value = -999; assert.notEqual(runtime.history(channel.id, '5m').points[0].value, -999);
  assert.throws(() => runtime.history('unknown', '5m'), RangeError);
  assert.throws(() => runtime.history(channel.id, '__proto__' as '5m'), RangeError);
  runtime.close(); assert.throws(() => runtime.replay(null), /closed/);
});

test('reconnect resumes a retained cursor, resets expired/restarted/ahead cursors and bounds replay at 30 frames', () => {
  const { runtime, advance } = fixture(100);
  const first = runtime.replay(null).frames[0]; advance(5000);
  assert.deepEqual(runtime.replay({ runId: runtime.runId, sequence: first.sequence }).frames.map(frame => frame.sequence), [2, 3, 4, 5, 6]);
  assert.deepEqual(runtime.replay({ runId: runtime.runId, sequence: 6 }).frames, []);
  assert.equal(runtime.replay({ runId: 'old-server', sequence: 1 }).reset, 'server_restart');
  assert.equal(runtime.replay({ runId: runtime.runId, sequence: 999 }).reset, 'cursor_ahead');
  advance(26000);
  const limited = runtime.replay({ runId: runtime.runId, sequence: 1 });
  assert.equal(limited.reset, 'history_expired'); assert.equal(limited.frames.length, 1);
  advance(200000);
  assert.equal(runtime.replay({ runId: runtime.runId, sequence: 32 }).reset, 'history_expired');
  runtime.close();
});

test('clock rollback before the first read yields empty data and later ticks never append backwards', () => {
  let clock = 100000;
  const runtime = new TelemetryRuntime(loadTelemetryDemoConfig(), { now: () => clock, automatic: false, runId: 'clock-test' });
  clock = 99000;
  assert.deepEqual(runtime.replay(null).frames, []);
  assert.equal(runtime.replay({ runId: 'prior-server', sequence: 1 }).reset, 'server_restart');
  const channel = runtime.catalog().channels[0].id;
  assert.deepEqual(runtime.history(channel, '5m').points, []);
  clock = 101000; runtime.tick(); const latest = runtime.replay(null).frames[0];
  clock = 98000; runtime.tick(); assert.deepEqual(runtime.replay(null).frames[0], latest);
  clock = NaN; assert.throws(() => runtime.history(channel, '5m'), /Invalid telemetry clock/);
  runtime.close();
});

test('subscriber cleanup, isolated client errors and the subscriber bound keep the producer usable', () => {
  const { runtime, advance } = fixture();
  const received: TelemetryFrame[] = [];
  const stop = runtime.subscribe(frame => { received.push(frame); frame.points[0].value = -999; });
  const failing = runtime.subscribe(() => { throw new Error('one client'); });
  advance(1000); assert.equal(received.length, 1);
  assert.notEqual(runtime.replay(null).frames[0].points[0].value, -999);
  stop(); failing(); advance(1000); assert.equal(received.length, 1);
  const listeners = Array.from({ length: 32 }, () => runtime.subscribe(() => {}));
  assert.throws(() => runtime.subscribe(() => {}), /limit/);
  listeners.forEach(remove => remove()); runtime.close(); advance(1000);
});

test('automatic producer starts on demand and publishes timed frames until explicitly closed', { timeout: 3000 }, async () => {
  const config = loadTelemetryDemoConfig(); config.sampleMs = 250;
  const runtime = new TelemetryRuntime(config);
  const events = new EventEmitter();
  // The production interval is intentionally unref'ed; keep this isolated test alive until it fires.
  const guard = setTimeout(() => events.emit('error', new Error('Producer did not publish')), 2000);
  const next = once(events, 'frame');
  const stop = runtime.subscribe(frame => events.emit('frame', frame));
  try {
    const [frame] = await next;
    assert.ok((frame as TelemetryFrame).sequence >= 2);
  } finally { clearTimeout(guard); stop(); runtime.close(); }
  assert.throws(() => runtime.replay(null), /closed/);
});

test('cursor parsing rejects oversized, injected, fractional and unsafe IDs without echoing input', () => {
  assert.equal(parseTelemetryCursor(undefined), null);
  assert.deepEqual(parseTelemetryCursor('test-run:12'), { runId: 'test-run', sequence: 12 });
  for (const value of ['', 'x:0', 'x:-1', 'x:1.2', 'x:01', 'x:9007199254740992', 'x\nevent:1', `${'x'.repeat(65)}:1`, 'x:1,x:2']) {
    assert.throws(() => parseTelemetryCursor(value), error => error instanceof RangeError && error.message === 'Invalid telemetry cursor');
  }
});

test('environment defaults to simulation, off/unknown modes do no config I/O and invalid seeds fail closed', () => {
  assert.equal(telemetryFromEnvironment('missing-root', { TELEMETRY_MODE: 'off' }), undefined);
  assert.equal(telemetryFromEnvironment('missing-root', { TELEMETRY_MODE: 'device' }), undefined);
  const normal = telemetryFromEnvironment(process.cwd(), {})!; assert.equal(normal.catalog().seed, 2777); normal.close();
  const seeded = telemetryFromEnvironment(process.cwd(), { TELEMETRY_SEED: '4294967295' })!;
  assert.equal(seeded.catalog().seed, 4294967295); seeded.close();
  for (const seed of ['-1', '', 'NaN', '4.2', ' 2777', '4294967296', '01']) assert.throws(() => telemetryFromEnvironment(process.cwd(), { TELEMETRY_SEED: seed }), /Invalid telemetry seed configuration/);
});

test('freshness distinguishes simulation/delay/offline; only a device source can be live and heartbeats do not reset sample age', () => {
  assert.equal(telemetryConnectionState('simulated', true, 1000, 6000, 5000), 'simulated');
  assert.equal(telemetryConnectionState('simulated', true, 1000, 6001, 5000), 'delayed');
  assert.equal(telemetryConnectionState('simulated', false, 6000, 6000, 5000), 'offline');
  assert.equal(telemetryConnectionState('device', true, 1000, 1000, 5000), 'live');
  assert.equal(telemetryConnectionState('simulated', true, null, 1000, 5000), 'delayed');
  for (const [received, now, threshold] of [[1000, 500, 5000], [NaN, 1000, 5000], [1000, Infinity, 5000], [1000, 1000, 0]]) {
    assert.equal(telemetryConnectionState('simulated', true, received, now, threshold), 'delayed');
  }
  const receivedAt = 1000;
  for (const heartbeatAt of [2000, 4000, 8000]) assert.equal(telemetryConnectionState('simulated', true, receivedAt, heartbeatAt, 5000), heartbeatAt > 6000 ? 'delayed' : 'simulated');
});

class Sink extends EventEmitter {
  chunks: string[] = [];
  blocked = false; destroyed = false; writableEnded = false; writableLength = 0;
  write(chunk: string) { this.chunks.push(chunk); return !this.blocked; }
  end() { this.writableEnded = true; }
  destroy() { this.destroyed = true; }
}
test('SSE writer preserves event IDs/retry, pauses on backpressure, resumes in order and cleans up', () => {
  const sink = new Sink(); sink.blocked = true;
  let closed = 0;
  const writer = createTelemetrySseWriter(sink, () => closed++);
  assert.equal(writer.send('catalog', { source: 'simulated' }), true);
  writer.send('telemetry', { sequence: 1 }, 'test:1'); writer.send('heartbeat', { at: 100 });
  assert.equal(sink.chunks.length, 1); assert.match(sink.chunks[0], /retry: 3000\nevent: catalog/);
  sink.blocked = false; sink.emit('drain');
  assert.equal(sink.chunks.length, 3); assert.match(sink.chunks[1], /^id: test:1\nevent: telemetry/);
  assert.doesNotMatch(sink.chunks[2], /^id:/);
  writer.close(); writer.close(); assert.equal(closed, 1); assert.equal(sink.listenerCount('drain'), 0);
  assert.equal(writer.send('telemetry', {}), false);
});
test('SSE byte/queue limits and failed sinks release slow or broken clients without retaining a drain listener', () => {
  const sink = new Sink(); sink.blocked = true;
  let closed = 0;
  const writer = createTelemetrySseWriter(sink, () => closed++, 1024);
  writer.send('catalog', {});
  for (let index = 0; index < 20; index++) writer.send('telemetry', { text: '仿真数据'.repeat(20) });
  assert.equal(writer.closed, true); assert.equal(closed, 1); assert.equal(sink.listenerCount('drain'), 0); assert.equal(sink.destroyed, true);
  const queued = new Sink(); queued.blocked = true;
  const queueWriter = createTelemetrySseWriter(queued, () => {});
  queueWriter.send('catalog', {});
  for (let index = 0; index < 65; index++) queueWriter.send('heartbeat', {});
  assert.equal(queueWriter.closed, true);
  const failed = new Sink(); failed.write = () => { throw new Error('socket'); };
  assert.equal(createTelemetrySseWriter(failed, () => {}).send('catalog', {}), false);
  const circular: { self?: unknown } = {}; circular.self = circular;
  assert.equal(createTelemetrySseWriter(new Sink(), () => {}).send('catalog', circular), false);
  const destroyed = new Sink(); destroyed.destroy();
  assert.equal(createTelemetrySseWriter(destroyed, () => {}).send('catalog', {}), false);
});
