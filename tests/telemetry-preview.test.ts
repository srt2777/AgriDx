import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewTelemetryTransport } from '../src/features/telemetry/preview-transport';
import { TelemetryStore } from '../src/features/telemetry/store';

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
test('static preview supplies catalog, prefilled history, advancing data and scoped scenario changes without HTTP', async t => {
  let now = 1800000000000;
  const transport = createPreviewTelemetryTransport(() => now);
  const store = new TelemetryStore(transport);
  t.after(() => store.dispose());
  store.subscribe(() => {});
  await settle();
  assert.equal(store.getSnapshot().catalog?.channels.length, 29);
  assert.equal(store.connectionState(), 'simulated');
  const id = 'diesel.engine.load';
  await store.loadHistory(id);
  const before = store.getSnapshot();
  assert.equal(before.historyStatus[id], 'ready');
  assert.ok(before.points[id].length >= 300);
  assert.ok(before.points[id].every(p => p.source === 'simulated'));
  now += 1000;
  store.retry();
  await settle();
  assert.ok(store.getSnapshot().latest[id].at > before.latest[id].at);
  await store.changeScenario('coolant-rise', false);
  assert.equal(store.getSnapshot().scenarioControl.phase, 'idle');
  assert.notEqual(store.getSnapshot().runId, before.runId);
  assert.equal(store.getSnapshot().sequence, 1);
  assert.equal(store.getSnapshot().scenario?.id, 'coolant-rise');
  await store.loadHistory(id);
  assert.equal(store.getSnapshot().points[id].length, 1, 'old scenario history is not retained');
});

test('preview cancels pending initialization and honors aborted reads', async () => {
  const transport = createPreviewTelemetryTransport();
  const source = transport.open();
  let opened = false;
  source.onopen = () => { opened = true; };
  source.close();
  await settle();
  assert.equal(opened, false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transport.history('/api/telemetry/history?channel=diesel.engine.rpm&window=1h', controller.signal));
});
