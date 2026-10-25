import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ApiError } from '../src/lib/api-client';
import { TelemetryStore } from '../src/features/telemetry/store';
import { parseTelemetryFrame, parseTelemetryScenarioState } from '../src/features/telemetry/protocol';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog } from '../server/telemetry/simulator';
import { TELEMETRY_WATERMARK, type TelemetryFrame, type TelemetryScenarioCommand, type TelemetryScenarioState } from '../shared/telemetry';

const config = loadTelemetryDemoConfig(), catalog = telemetryCatalog(config);
function frame(runId = 'run-a', revision = 0, id: TelemetryScenarioState['id'] = 'normal', sequence = 1): TelemetryFrame {
  const data = simulateTelemetry(config, { elapsedMs: (sequence - 1) * 1000, scenario: id });
  return { ...data, schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, runId, sequence,
    scenario: { ...data.scenario, revision, startedAt: 0 } };
}
function state(id: TelemetryScenarioState['id'] = 'coolant-rise', revision = 1, runId = 'run-b'): TelemetryScenarioState {
  return { schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, scope: 'shared-service', runId,
    revision, id, loop: false, startedAt: 0, elapsedMs: 0 };
}
class Source extends EventTarget {
  onopen: EventSource['onopen'] = null; onerror: EventSource['onerror'] = null;
  close() {}
  message(event: string, data: unknown) { this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) })); }
}
function fixture(t: TestContext, command: (payload: TelemetryScenarioCommand, signal: AbortSignal) => Promise<unknown>) {
  const source = new Source(); let now = 100000;
  const store = new TelemetryStore({ open: () => source as unknown as EventSource, command, now: () => now });
  t.after(() => store.dispose()); store.subscribe(() => {}); source.onopen?.call(source as unknown as EventSource, new Event('open'));
  source.message('catalog', catalog); source.message('telemetry', frame());
  return { store, source, advance(ms: number) { now += ms; store.refresh(); } };
}

test('scenario state and optional frame metadata are validated without rejecting legacy generator snapshots', () => {
  assert.deepEqual(parseTelemetryScenarioState(state(), catalog), state()); assert.deepEqual(parseTelemetryFrame(frame(), catalog), frame());
  const legacy = frame(); delete legacy.scenario.revision; delete legacy.scenario.startedAt;
  assert.doesNotThrow(() => parseTelemetryFrame(legacy, catalog));
  for (const changed of [{ ...state(), source: 'device' }, { ...state(), watermark: '' }, { ...state(), scope: 'private' },
    { ...state(), revision: -1 }, { ...state(), id: 'unknown' }, { ...state(), startedAt: Infinity }, { ...state(), elapsedMs: 120001 },
    { ...state(), loop: true, elapsedMs: 120000 }]) assert.throws(() => parseTelemetryScenarioState(changed, catalog));
  for (const scenario of [{ ...frame().scenario, revision: undefined }, { ...frame().scenario, startedAt: 1 },
    { ...frame().scenario, elapsedMs: 1000 }, { ...frame().scenario, revision: -1 }]) {
    assert.throws(() => parseTelemetryFrame({ ...frame(), scenario }, catalog));
  }
});

test('manual writes share one pending command and never replace measurements with the HTTP metadata reply', async t => {
  let resolve!: (value: unknown) => void, calls = 0; let payload: TelemetryScenarioCommand | undefined;
  const f = fixture(t, async command => { calls++; payload = command; return new Promise(done => { resolve = done; }); });
  const before = f.store.getSnapshot(), request = f.store.changeScenario('coolant-rise', false);
  assert.equal(f.store.changeScenario('battery-spread', true), request); assert.equal(f.store.getSnapshot().scenarioControl.phase, 'pending');
  await Promise.resolve(); assert.equal(calls, 1); assert.deepEqual(payload, { expectedRunId: 'run-a', revision: 0, id: 'coolant-rise', loop: false });
  resolve(state()); await request;
  const after = f.store.getSnapshot(); assert.equal(after.scenarioControl.phase, 'idle'); assert.equal(after.runId, 'run-a');
  assert.equal(after.points, before.points); assert.equal(after.latest, before.latest); assert.equal(after.scenario?.id, 'normal');
});

test('the successful new-run SSE broadcast may arrive before the POST reply without cancelling or reverting it', async t => {
  let resolve!: (value: unknown) => void, aborted = false;
  const f = fixture(t, async (_command, signal) => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise(done => { resolve = done; }); });
  const request = f.store.changeScenario('coolant-rise', false); await Promise.resolve();
  f.source.message('telemetry', frame('run-b', 1, 'coolant-rise'));
  assert.equal(aborted, false); assert.equal(f.store.getSnapshot().scenarioControl.phase, 'pending'); assert.equal(f.store.getSnapshot().runId, 'run-b');
  f.source.message('telemetry', frame('run-c', 2, 'position-drift'));
  resolve(state()); await request;
  assert.equal(f.store.getSnapshot().runId, 'run-c'); assert.equal(f.store.getSnapshot().scenario?.id, 'position-drift');
  assert.equal(f.store.getSnapshot().scenarioControl.phase, 'idle', 'late acknowledgement does not restore the previous scene');
});

test('409 keeps a validated current-scene notice, performs no retry and never promotes conflict metadata into samples', async t => {
  let calls = 0; const current = state('position-drift', 2, 'other-run');
  const f = fixture(t, async () => { calls++; throw new ApiError(409, { state: current }); });
  const points = f.store.getSnapshot().points; await f.store.changeScenario('coolant-rise', false);
  assert.equal(calls, 1); assert.deepEqual(f.store.getSnapshot().scenarioControl, { phase: 'conflict', error: null, conflict: current });
  assert.equal(f.store.getSnapshot().runId, 'run-a'); assert.equal(f.store.getSnapshot().points, points);
});

test('invalid, foreign or mismatched control acknowledgements fail safely without changing the stream data', async t => {
  for (const reply of [{ ...state(), source: 'device' }, { ...state(), loop: true }, state('battery-spread'), state('coolant-rise', 2), state('coolant-rise', 1, 'run-a'), null]) {
    const f = fixture(t, async () => reply); await f.store.changeScenario('coolant-rise', false);
    assert.equal(f.store.getSnapshot().scenarioControl.error, 'invalid_data'); assert.equal(f.store.getSnapshot().runId, 'run-a');
    f.store.dispose();
  }
  const invalidConflict = fixture(t, async () => { throw new ApiError(409, { state: { ...state(), source: 'device' } }); });
  await invalidConflict.store.changeScenario('coolant-rise', false); assert.equal(invalidConflict.store.getSnapshot().scenarioControl.error, 'invalid_data');
});

test('offline, delayed or legacy metadata cannot write; rate and network failures never retry automatically', async t => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; return state(); });
  await f.store.changeScenario('unknown' as never, false); assert.equal(calls, 0);
  f.source.onerror?.call(f.source as unknown as EventSource, new Event('error'));
  await f.store.changeScenario('coolant-rise', false); assert.equal(calls, 0, 'offline metadata cannot authorize a write');
  f.source.message('telemetry', frame('run-a', 0, 'normal', 2));
  f.advance(catalog.staleAfterMs + 1); await f.store.changeScenario('coolant-rise', false); assert.equal(calls, 0);
  f.source.message('telemetry', frame('run-a', 0, 'normal', 3));
  const legacy = frame('run-a', 0, 'normal', 4); delete legacy.scenario.revision; delete legacy.scenario.startedAt;
  f.source.message('telemetry', legacy); await f.store.changeScenario('coolant-rise', false); assert.equal(calls, 0);
  for (const error of [new ApiError(429, {}), new ApiError(503, {}), new TypeError('network')]) {
    let attempts = 0; const failed = fixture(t, async () => { attempts++; throw error; });
    await failed.store.changeScenario('coolant-rise', false); assert.equal(attempts, 1);
    assert.equal(failed.store.getSnapshot().scenarioControl.error, error instanceof ApiError && error.status === 429 ? 'rate_limited' : 'unavailable');
    failed.store.dispose();
  }
});

test('a timed out request is aborted and leaves the outcome unconfirmed rather than retrying the write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0, signal: AbortSignal | undefined;
  const f = fixture(t, async (_command, abort) => { calls++; signal = abort; return new Promise((_resolve, reject) => abort.addEventListener('abort', () => reject(abort.reason))); });
  const request = f.store.changeScenario('coolant-rise', false); await Promise.resolve(); t.mock.timers.tick(12000); await request;
  assert.equal(signal?.aborted, true); assert.equal(calls, 1); assert.equal(f.store.getSnapshot().scenarioControl.error, 'unavailable');
});

test('dispose and explicit retry cancel an outstanding command and discard its late acknowledgement', async t => {
  for (const action of ['dispose', 'retry'] as const) {
    let resolve!: (value: unknown) => void, signal: AbortSignal | undefined;
    const f = fixture(t, async (_command, abort) => { signal = abort; return new Promise(done => { resolve = done; }); });
    const request = f.store.changeScenario('coolant-rise', false); await Promise.resolve(); f.store[action]();
    assert.equal(signal?.aborted, true); const snapshot = f.store.getSnapshot(); resolve(state()); await request;
    assert.equal(f.store.getSnapshot(), snapshot); assert.equal(f.store.getSnapshot().scenarioControl.phase, 'idle');
    f.store.dispose();
  }
});
