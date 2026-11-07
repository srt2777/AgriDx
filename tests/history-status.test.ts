import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { TELEMETRY_WATERMARK, type TelemetryFrame, type TelemetryHistory } from '../shared/telemetry';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog } from '../server/telemetry/simulator';
import { TelemetryStore, type TelemetryHistoryStatus } from '../src/features/telemetry/store';
import { freezeTelemetrySnapshot, historyStatusCsvSection, historyStatusLabel, telemetryCsv } from '../src/features/telemetry/presentation';

const config = loadTelemetryDemoConfig(), catalog = telemetryCatalog(config);
const channelA = catalog.channels[0], channelB = catalog.channels[1];
function frame(sequence = 1, runId = 'history-run'): TelemetryFrame {
  return { ...simulateTelemetry(config, { elapsedMs: (sequence - 1) * 1000 }), schemaVersion: 1,
    source: 'simulated', watermark: TELEMETRY_WATERMARK, sequence, runId };
}
function history(count = 5, channelId = channelA.id, runId = 'history-run'): TelemetryHistory {
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
function fixture(t: TestContext, read: (path: string, signal: AbortSignal) => Promise<unknown>) {
  const now = 100000;
  const stream = new FakeStream();
  const store = new TelemetryStore({ now: () => now, history: read, open: () => stream as unknown as EventSource });
  t.after(() => store.dispose());
  const unsubscribe = store.subscribe(() => {}); stream.open(); stream.message('catalog', catalog);
  return { store, stream, unsubscribe };
}

test('history success with zero samples is empty, not ready; live points promote it to ready', async t => {
  const f = fixture(t, async () => history(0));
  await f.store.loadHistory(channelA.id);
  assert.equal(f.store.getSnapshot().historyStatus[channelA.id], 'empty');
  f.stream.message('telemetry', frame());
  assert.equal(f.store.getSnapshot().historyStatus[channelA.id], 'ready');
});

test('history success with zero samples but stream points already received is ready', async t => {
  const f = fixture(t, async () => history(0));
  f.stream.message('telemetry', frame());
  await f.store.loadHistory(channelA.id);
  assert.equal(f.store.getSnapshot().historyStatus[channelA.id], 'ready');
  assert.ok(f.store.getSnapshot().points[channelA.id].length > 0);
});

test('one failed channel stays error while the other succeeds, and retry only refetches the failed one', async t => {
  const calls = new Map<string, number>();
  const f = fixture(t, async path => {
    const id = new URL(path, 'https://test.invalid').searchParams.get('channel')!;
    calls.set(id, (calls.get(id) ?? 0) + 1);
    if (id === channelB.id && calls.get(id) === 1) throw new Error('unavailable');
    return history(3, id);
  });
  await Promise.all([f.store.loadHistory(channelA.id), f.store.loadHistory(channelB.id)]);
  assert.equal(f.store.getSnapshot().historyStatus[channelA.id], 'ready');
  assert.equal(f.store.getSnapshot().historyStatus[channelB.id], 'error');
  assert.equal(f.store.getSnapshot().points[channelA.id].length, 3);
  await f.store.retryHistory(channelB.id);
  assert.equal(f.store.getSnapshot().historyStatus[channelB.id], 'ready');
  assert.equal(calls.get(channelA.id), 1, 'retry must not refetch a ready channel');
  assert.equal(calls.get(channelB.id), 2);
  assert.equal(f.store.getSnapshot().points[channelA.id].length, 3, 'retry must not touch the other channel');
});

test('frozen snapshot keeps the history status captured at freeze time even if live status later changes', () => {
  const rows = [{ id: channelA.id, label: 'A', points: [{ at: 1, value: 2 }] }];
  const live: Record<string, TelemetryHistoryStatus> = { [channelA.id]: 'error' };
  const samples: Record<string, number> = { [channelA.id]: 0 };
  const frozen = freezeTelemetrySnapshot({ rows, history: live, samples, capturedAt: 1000, runId: 'run-1', window: '5m' });
  live[channelA.id] = 'ready'; samples[channelA.id] = 5;
  (rows[0].points as { value: number }[])[0].value = 99;
  assert.equal(frozen.history[channelA.id], 'error');
  assert.equal(frozen.samples[channelA.id], 0);
  assert.equal((frozen.rows[0].points as { value: number }[])[0].value, 2);
  assert.equal(frozen.capturedAt, 1000); assert.equal(frozen.runId, 'run-1'); assert.equal(frozen.window, '5m');
});

test('history status labels distinguish loading, completed, completed-but-empty and failed in both languages', () => {
  assert.equal(historyStatusLabel('loading', 'zh'), '历史加载中');
  assert.equal(historyStatusLabel('ready', 'zh'), '历史请求已完成');
  assert.equal(historyStatusLabel('empty', 'zh'), '历史请求已完成 · 暂无样本');
  assert.equal(historyStatusLabel('error', 'zh'), '历史读取失败');
  assert.equal(historyStatusLabel('loading', 'en'), 'Loading history');
  assert.equal(historyStatusLabel('ready', 'en'), 'History request completed');
  assert.equal(historyStatusLabel('empty', 'en'), 'History request completed · no samples yet');
  assert.equal(historyStatusLabel('error', 'en'), 'History request failed');
});

test('export status section lists every channel including a zero-sample failed one, and names incomplete channels', () => {
  const entries = [
    { channelId: channelA.id, label: '通道 A', status: 'ready' as TelemetryHistoryStatus, samples: 3 },
    { channelId: channelB.id, label: '通道 B', status: 'error' as TelemetryHistoryStatus, samples: 0 },
    { channelId: catalog.channels[2].id, label: '通道 C', status: 'empty' as TelemetryHistoryStatus, samples: 0 },
  ];
  const section = historyStatusCsvSection(entries, { runId: 'run-1', window: '5m', source: 'simulated', mode: 'snapshot', capturedAt: 1000 }, 'zh');
  assert.match(section, new RegExp(`"${channelB.id}"`));
  assert.match(section, /"error"/);
  assert.match(section, /"history_status"/);
  assert.match(section, /"history_summary"/);
  assert.match(section, new RegExp(channelB.id), 'failed channel must appear in the incomplete list');
  assert.doesNotMatch(section, new RegExp(`incomplete[^\\r\\n]*${channelA.id}`), 'a ready channel must not be listed as incomplete');
  assert.doesNotMatch(section, /数据已核验|无缺口|no gaps|verified/);
});

test('telemetry CSV keeps its original shape without history options, and appends the status section with them', () => {
  const point = frame(1).points.find(p => p.channelId === channelA.id)!;
  const row = { channel: channelA, windowPoints: [point] };
  const plain = telemetryCsv([row], 'en');
  assert.equal(plain.trim().split('\r\n').length, 2, 'no invented rows without history options');
  const withHistory = telemetryCsv([row], 'en', { history: {
    entries: [{ channelId: channelA.id, label: channelA.name.en, status: 'error', samples: 0 }],
    runId: 'run-1', window: '5m', source: 'simulated', mode: 'live', capturedAt: null,
  } });
  assert.ok(withHistory.startsWith(plain), 'sample rows stay first and unchanged');
  assert.match(withHistory, /"history_status"/);
  assert.match(withHistory, /"history_summary"/);
  assert.ok(withHistory.includes(`"${point.value}"`), 'original samples are retained');
});
