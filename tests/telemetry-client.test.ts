import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { TELEMETRY_WATERMARK, type TelemetryFrame, type TelemetryHistory, type TelemetryPoint } from '../shared/telemetry';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog } from '../server/telemetry/simulator';
import { downsampleTelemetry, mergeTelemetryPoints, parseTelemetryCatalog, parseTelemetryEvent, parseTelemetryFrame, parseTelemetryHistory, selectTelemetryChannels } from '../src/features/telemetry/protocol';
import { TelemetryStore } from '../src/features/telemetry/store';

const config = loadTelemetryDemoConfig(), catalog = telemetryCatalog(config), channel = catalog.channels[0];
function frame(sequence = 1, runId = 'client-run'): TelemetryFrame {
  return { ...simulateTelemetry(config, { elapsedMs: (sequence - 1) * 1000 }), schemaVersion: 1,
    source: 'simulated', watermark: TELEMETRY_WATERMARK, sequence, runId };
}
function history(count = 5, channelId = channel.id, runId = 'client-run'): TelemetryHistory {
  return { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, runId,
    channel: catalog.channels.find(item => item.id === channelId)!, window: '1h', from: 0, to: Math.max(0, count - 1) * 1000,
    points: Array.from({ length: count }, (_, index) => frame(index + 1).points.find(point => point.channelId === channelId)!) };
}
class FakeStream extends EventTarget {
  onopen: EventSource['onopen'] = null; onerror: EventSource['onerror'] = null;
  closed = 0;
  open() { this.onopen?.call(this as unknown as EventSource, new Event('open')); }
  error() { this.onerror?.call(this as unknown as EventSource, new Event('error')); }
  message(event: string, data: unknown) { this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) })); }
  close() { this.closed++; }
}
function fixture(t: TestContext, read: (path: string, signal: AbortSignal) => Promise<unknown> = async () => history()) {
  const sources: FakeStream[] = []; let now = 100000;
  const store = new TelemetryStore({ now: () => now, history: read, open: () => {
    const stream = new FakeStream(); sources.push(stream); return stream as unknown as EventSource;
  } });
  t.after(() => store.dispose());
  const unsubscribe = store.subscribe(() => {}), source = sources[0]; source.open(); source.message('catalog', catalog);
  return { store, source, sources, unsubscribe, advance(ms: number) { now += ms; store.refresh(); } };
}

test('protocol accepts backend simulation but rejects device/provenance, invalid channels, points and alert sources', () => {
  assert.deepEqual(parseTelemetryCatalog(catalog), catalog); assert.deepEqual(parseTelemetryFrame(frame(), catalog), frame());
  for (const bad of [{ ...catalog, source: 'device' }, { ...catalog, watermark: '' }, { ...catalog, channels: [] },
    { ...catalog, channels: [...catalog.channels, catalog.channels[0]] }]) assert.throws(() => parseTelemetryCatalog(bad));
  const badThreshold = structuredClone(catalog); badThreshold.channels[1].threshold!.note = 'manufacturer' as never;
  assert.throws(() => parseTelemetryCatalog(badThreshold));
  const missingState = structuredClone(catalog); missingState.channels.find(item => item.kind === 'state')!.valueLabels!.pop();
  assert.throws(() => parseTelemetryCatalog(missingState));
  for (const change of [(data: TelemetryFrame) => { data.points[0].source = 'device'; },
    (data: TelemetryFrame) => { data.points[0].value = Infinity; }, (data: TelemetryFrame) => { data.points[0].deviceId = 'wrong-device'; },
    (data: TelemetryFrame) => { data.points[0].at++; }, (data: TelemetryFrame) => { data.points[1] = data.points[0]; }]) {
    const data = frame(); change(data); assert.throws(() => parseTelemetryFrame(data, catalog));
  }
  const heat: TelemetryFrame = { ...frame(86), ...simulateTelemetry(config, { elapsedMs: 85000, scenario: 'coolant-rise' }) };
  assert.ok(parseTelemetryFrame(heat, catalog).alerts.length);
  heat.alerts[0].channelId = channel.id; assert.equal(channel.threshold, null);
  assert.throws(() => parseTelemetryFrame(heat, catalog), 'trend-only channels must never acquire a conclusion');
  assert.throws(() => parseTelemetryEvent('<html>unavailable</html>')); assert.throws(() => parseTelemetryEvent(' '.repeat(262145)));
});

test('history validates scope, source, ordering, range, window and capacity before entering the cache', () => {
  const valid = history(); assert.deepEqual(parseTelemetryHistory(valid, catalog, channel.id, '1h'), valid);
  for (const change of [(data: TelemetryHistory) => { data.points[0].source = 'device'; },
    (data: TelemetryHistory) => { data.channel = catalog.channels[1]; }, (data: TelemetryHistory) => { data.points.reverse(); },
    (data: TelemetryHistory) => { data.points[0].value = channel.range.max + 1; },
    (data: TelemetryHistory) => { data.to = 3600001; }, (data: TelemetryHistory) => { data.window = '5m'; }]) {
    const data = structuredClone(valid); change(data); assert.throws(() => parseTelemetryHistory(data, catalog, channel.id, '1h'));
  }
  const duplicate = structuredClone(valid); duplicate.points.push(duplicate.points.at(-1)!);
  assert.throws(() => parseTelemetryHistory(duplicate, catalog, channel.id, '1h'));
});

test('hook channel selection scopes model and part together, bounds multi-channel views and never borrows a foreign device', () => {
  assert.deepEqual(selectTelemetryChannels(null, {}), []); assert.deepEqual(selectTelemetryChannels(catalog, {}), []);
  const engine = selectTelemetryChannels(catalog, { modelId: 'diesel', partId: 'engine' });
  assert.equal(engine.length, 3); assert.ok(engine.every(item => item.deviceId === 'diesel-demo' && item.partId === 'engine'));
  const ambiguous = structuredClone(catalog);
  ambiguous.channels.push({ ...catalog.channels.find(item => item.partId === 'battery_box')!, id: 'foreign.battery', deviceId: 'diesel-demo' });
  const battery = selectTelemetryChannels(ambiguous, { modelId: 't70', partId: 'battery_box' });
  assert.equal(battery.length, 3); assert.ok(battery.every(item => item.deviceId === 't70-demo'));
  assert.equal(selectTelemetryChannels(ambiguous, { modelId: 't70', channelIds: ['foreign.battery'] }).length, 0);
  assert.equal(selectTelemetryChannels(catalog, { channelIds: catalog.channels.map(item => item.id) }).length, 4);
});

test('subscribers share a single source and same-tick Strict Mode resubscription does not open a second one', async t => {
  const f = fixture(t); const second = f.store.subscribe(() => {});
  assert.equal(f.sources.length, 1); const before = f.store.getSnapshot(); assert.equal(f.store.getSnapshot(), before);
  f.source.message('telemetry', frame()); assert.notEqual(f.store.getSnapshot(), before);
  f.unsubscribe(); second();
  const remount = f.store.subscribe(() => {}); assert.equal(f.sources.length, 1); assert.equal(f.source.closed, 0);
  remount(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.source.closed, 1);
  const stopped = f.store.getSnapshot(); f.source.message('telemetry', frame(2)); assert.equal(f.store.getSnapshot(), stopped);
});

test('native reconnection, delayed samples and offline status stay separate from heartbeats and manual retry', t => {
  const f = fixture(t); f.source.message('telemetry', frame()); assert.equal(f.store.connectionState(), 'simulated');
  const received = f.store.getSnapshot().receivedAt;
  f.advance(catalog.staleAfterMs + 1); f.source.message('heartbeat', { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, at: 200000 });
  assert.equal(f.store.getSnapshot().receivedAt, received); assert.equal(f.store.connectionState(), 'delayed');
  f.source.error(); assert.equal(f.store.connectionState(), 'offline'); assert.equal(f.source.closed, 0, 'native retry remains active');
  f.source.open(); f.source.message('catalog', catalog); f.source.message('telemetry', frame(2)); assert.equal(f.store.connectionState(), 'simulated');
  f.store.retry(); assert.equal(f.source.closed, 1); assert.equal(f.sources.length, 2);
  assert.equal(f.store.getSnapshot().catalog, null); assert.equal(f.store.getSnapshot().phase, 'loading');
});

test('history requests deduplicate, preserve newer stream points and cache a single 1h read for local window changes', async t => {
  let calls = 0;
  const f = fixture(t, async path => { calls++; const params = new URL(path, 'https://test.invalid').searchParams;
    assert.equal(params.get('window'), '1h'); assert.equal(params.get('channel'), channel.id); return history(); });
  f.source.message('telemetry', frame(10));
  const first = f.store.loadHistory(channel.id), second = f.store.loadHistory(channel.id); assert.equal(first, second); await first;
  assert.equal(calls, 1); assert.equal(f.store.getSnapshot().points[channel.id].length, 6);
  assert.equal(f.store.getSnapshot().latest[channel.id].at, 9000);
  await f.store.loadHistory(channel.id); assert.equal(calls, 1);
  f.source.message('telemetry', frame(11)); assert.equal(f.store.getSnapshot().points[channel.id].length, 7);
  await f.store.retryHistory(channel.id); assert.equal(calls, 2);
});

test('returning after the final observer unmounted refills history instead of connecting across an unobserved gap', async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return history(calls === 1 ? 5 : 30); });
  f.source.message('telemetry', frame(5)); await f.store.loadHistory(channel.id);
  f.unsubscribe(); await new Promise(resolve => setTimeout(resolve, 5));
  const remove = f.store.subscribe(() => {}), source = f.sources.at(-1)!;
  source.open(); source.message('catalog', catalog); source.message('telemetry', frame(30));
  assert.notEqual(f.store.getSnapshot().historyStatus[channel.id], 'ready');
  await f.store.loadHistory(channel.id); assert.equal(calls, 2); assert.equal(f.store.getSnapshot().points[channel.id].length, 30);
  remove();
});

test('reset cancels old history, clears old run values and ignores late responses or duplicate frames', async t => {
  let resolve!: (value: unknown) => void;
  const f = fixture(t, () => new Promise(done => { resolve = done; }));
  f.source.message('telemetry', frame()); const oldEpoch = f.store.getSnapshot().epoch;
  const pending = f.store.loadHistory(channel.id); await Promise.resolve();
  f.source.message('reset', { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, runId: 'new-run', reason: 'server_restart' });
  f.source.message('telemetry', frame(1, 'new-run')); resolve(history(5)); await pending;
  assert.equal(f.store.getSnapshot().runId, 'new-run'); assert.ok(f.store.getSnapshot().epoch > oldEpoch);
  assert.equal(f.store.getSnapshot().points[channel.id].length, 1);
  const snapshot = f.store.getSnapshot(); f.source.message('telemetry', frame(1, 'new-run')); assert.equal(f.store.getSnapshot(), snapshot);
});

test('empty history and failed per-channel requests remain explicit and retry works after a synchronous rejection', async t => {
  let calls = 0;
  const f = fixture(t, () => { calls++; if (calls === 1) throw new Error('unavailable'); return Promise.resolve(history(0)); });
  await f.store.loadHistory(channel.id); assert.equal(f.store.getSnapshot().historyStatus[channel.id], 'error');
  await f.store.retryHistory(channel.id); assert.equal(f.store.getSnapshot().phase, 'empty'); assert.equal(calls, 2);
  assert.deepEqual(f.store.getSnapshot().points[channel.id], []);
  f.source.message('telemetry', frame()); assert.equal(f.store.getSnapshot().phase, 'ready');
});

test('foreign history run cannot replace current data and malformed packets close the source until manual retry', async t => {
  const f = fixture(t, async () => history(5, channel.id, 'wrong-run'));
  f.source.message('telemetry', frame()); await f.store.loadHistory(channel.id);
  assert.equal(f.store.getSnapshot().historyStatus[channel.id], 'error'); assert.equal(f.store.getSnapshot().points[channel.id].length, 1);
  f.source.message('telemetry', { ...frame(2), source: 'device' });
  assert.equal(f.store.getSnapshot().error, 'invalid_data'); assert.equal(f.store.connectionState(), 'offline'); assert.equal(f.source.closed, 1);
  f.store.retry(); assert.equal(f.sources.length, 2);
});

test('static preview fails explicitly without opening a stream, generating points or requesting a fallback', async t => {
  let network = 0;
  const store = new TelemetryStore({ supported: false, open: () => { network++; throw new Error('must not run'); }, history: async () => { network++; return {}; } });
  t.after(() => store.dispose()); store.subscribe(() => {});
  await store.loadHistory(channel.id); store.retry();
  assert.equal(network, 0); assert.equal(store.getSnapshot().phase, 'error'); assert.equal(store.getSnapshot().error, 'unsupported');
  assert.deepEqual(store.getSnapshot().latest, {});
});

test('client history is capped at 3600 real samples and peak-preserving downsampling never invents values', async t => {
  const raw = history(3600);
  const f = fixture(t, async () => raw); f.source.message('telemetry', frame()); await f.store.loadHistory(channel.id);
  f.source.message('telemetry', frame(3601)); const points = f.store.getSnapshot().points[channel.id];
  assert.equal(points.length, 3600); assert.equal(points.at(-1)!.at, 3600000);
  const rows = points.map(point => ({ ...point })); rows[50].value = channel.range.max; rows[51].value = channel.range.min;
  const sampled = downsampleTelemetry(rows, 240); assert.ok(sampled.length <= 240);
  assert.equal(sampled[0], rows[0]); assert.equal(sampled.at(-1), rows.at(-1));
  assert.ok(sampled.includes(rows[50]) && sampled.includes(rows[51]));
  assert.ok(sampled.every((point, index) => rows.includes(point) && (!index || point.at > sampled[index - 1].at)));
  assert.deepEqual(downsampleTelemetry([], 4), []); assert.throws(() => downsampleTelemetry(rows, 3), RangeError);
  const merged = mergeTelemetryPoints(rows.slice(0, 3), [rows[2], rows[3]]); assert.equal(merged.length, 4);
});
