import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReplayTimeline, cursorAt, pointsThrough, resetForRun } from '../src/pages/FaultDetectionPage/telemetry-replay';
import type { TelemetryPoint } from '../shared/telemetry';

function point(at: number, elapsedMs: number, value: number, channelId = 'engine.coolant') : TelemetryPoint {
  return { channelId, deviceId: 'diesel-demo', source: 'simulated', at, elapsedMs, value };
}

test('replay timeline sorts received samples and removes exact duplicates only', () => {
  const timeline = buildReplayTimeline([
    point(3000, 2000, 78), point(1000, 0, 76), point(3000, 2000, 78), point(2000, 1000, 77),
    point(3000, 2000, 79), point(5000, 4000, Number.NaN), point(9000, 0, 99, 'other'),
  ], 'engine.coolant');
  assert.deepEqual(timeline.points.map(item => item.point.value), [76, 77, 78, 79]);
  assert.equal(timeline.from, 1000); assert.equal(timeline.to, 3000);
});

test('cursor and prefix never move beyond received history or interpolate', () => {
  const timeline = buildReplayTimeline([point(1000, 0, 76), point(2000, 1000, 77), point(3000, 2000, 78)], 'engine.coolant');
  assert.deepEqual(pointsThrough(timeline, cursorAt(timeline, 1500)).map(item => item.point.value), [76, 77]);
  assert.deepEqual(pointsThrough(timeline, cursorAt(timeline, 99999)).map(item => item.point.value), [76, 77, 78]);
  assert.equal(cursorAt(timeline, -1).index, 0);
  assert.equal(pointsThrough(timeline, { index: 99, elapsedMs: 99999, mode: 'paused-view' }).length, 3);
});

test('run reset is explicit and does not look like a network interruption', () => {
  assert.deepEqual(resetForRun(), { index: -1, elapsedMs: 0, mode: 'received-history' });
});
