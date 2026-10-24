import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEMO_THRESHOLD_NOTE, TELEMETRY_WATERMARK, type TelemetryPoint } from '../shared/telemetry';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog, telemetryDemoAlerts, validateTelemetryDemoConfig, type TelemetryDemoConfig } from '../server/telemetry/simulator';

const config = loadTelemetryDemoConfig();
const epochMs = Date.UTC(2026, 9, 25);
const sample = (elapsedMs: number, scenario: typeof config.scenarios[number]['id'] = 'normal', extra = {}) => simulateTelemetry(config, { elapsedMs, epochMs, scenario, ...extra });
const byId = (points: TelemetryPoint[], channelId: string) => points.find(point => point.channelId === channelId)!;

test('configured channels bind to actual parts.json IDs with independent device scopes and bilingual provenance', () => {
  const required = {
    diesel: ['engine', 'radiator', 'battery', 'gearbox', 'hydraulic_lift', 'front_axle', 'rear_axle', 'fuel_tank'],
    t70: ['battery_box', 'gps_antenna', 'sensor_roof_l', 'sensor_roof_r', 'hub_fl', 'hub_fr', 'hub_rl', 'hub_rr'],
  };
  for (const device of config.devices) {
    const directory = device.modelId === 'diesel' ? 'tractor-parts' : 't70-parts';
    const manifest = JSON.parse(readFileSync(`public/models/${directory}/parts.json`, 'utf8')) as { parts: { part_id: string }[] };
    const parts = new Set(manifest.parts.map(part => part.part_id));
    const channels = config.channels.filter(channel => channel.deviceId === device.id);
    for (const part of required[device.modelId]) assert.ok(channels.some(channel => channel.partId === part), part);
    for (const channel of channels) {
      assert.ok(parts.has(channel.partId), channel.id);
      assert.equal(channel.source, 'simulated'); assert.ok(channel.name.zh && channel.name.en);
      if (channel.threshold) { assert.equal(channel.threshold.source, 'demo'); assert.equal(channel.threshold.note, DEMO_THRESHOLD_NOTE); }
    }
  }
  assert.equal(new Set(config.channels.map(channel => channel.id)).size, config.channels.length);
});

test('same seed and clock reproduce the curve regardless of call order, unrelated channels or object instance', () => {
  const times = [0, 1500, 19000, 45000, 85000, 86400000];
  const expected = times.map(elapsedMs => sample(elapsedMs));
  times.slice().reverse().forEach(elapsedMs => sample(elapsedMs, 'position-drift', { seed: 123 }));
  assert.deepEqual(times.map(elapsedMs => sample(elapsedMs)), expected);
  const reordered = structuredClone(config); reordered.channels.reverse();
  assert.deepEqual(simulateTelemetry(reordered, { elapsedMs: 45000, epochMs }).points.sort((a, b) => a.channelId.localeCompare(b.channelId)),
    sample(45000).points.sort((a, b) => a.channelId.localeCompare(b.channelId)));
  assert.notDeepEqual(sample(45000, 'normal', { seed: 2778 }).points, sample(45000).points);
  assert.deepEqual(loadTelemetryDemoConfig(), config, 'simulation must not mutate configuration');
});

test('smooth seeded noise is continuous at knots and a noise-free daily cycle repeats after a day', () => {
  const channel = config.channels.find(item => item.id === 'diesel.engine.coolant')!;
  const at = channel.noise.periodMs;
  const values = [at - 1, at, at + 1].map(time => byId(sample(time).points, channel.id).value);
  assert.ok(Math.max(...values) - Math.min(...values) <= .100001);
  const quiet = structuredClone(config); quiet.channels.forEach(item => { item.noise.amplitude = 0; });
  const daily = [0, 21600000, 43200000, 64800000, 86400000].map(elapsedMs =>
    byId(simulateTelemetry(quiet, { elapsedMs }).points, channel.id).value);
  assert.equal(daily[0], daily.at(-1));
  assert.ok(Math.max(...daily) - Math.min(...daily) > channel.dailyAmplitude);
});

test('each scenario starts deviating only on its configured timeline and leaves unrelated channels untouched', () => {
  for (const scenario of config.scenarios.filter(item => item.id !== 'normal')) {
    for (const track of scenario.tracks) {
      const start = track.keyframes[1][0], peak = track.keyframes[2][0];
      for (const time of [0, start - 1, start]) assert.equal(byId(sample(time, scenario.id).points, track.channelId).value,
        byId(sample(time).points, track.channelId).value, `${scenario.id} must not deviate early`);
      assert.ok(byId(sample(peak, scenario.id).points, track.channelId).value > byId(sample(peak).points, track.channelId).value, scenario.id);
    }
    const affected = new Set(scenario.tracks.map(track => track.channelId));
    const baseline = sample(85000);
    for (const point of sample(85000, scenario.id).points.filter(point => !affected.has(point.channelId))) assert.deepEqual(point, byId(baseline.points, point.channelId));
    assert.ok(sample(85000, scenario.id).alerts.length > 0, `${scenario.id} reaches a configured demo alert`);
  }
});

test('manual scenario clocks, returning to normal and optional loops do not reset the source time or random curve', () => {
  const elapsedMs = 245000;
  for (const scenario of config.scenarios) {
    const looping = sample(elapsedMs, scenario.id, { loop: true });
    const manual = sample(elapsedMs, scenario.id, { scenarioElapsedMs: elapsedMs % scenario.durationMs });
    assert.deepEqual(looping.points, manual.points);
    assert.equal(looping.at, epochMs + elapsedMs);
    assert.equal(looping.scenario.elapsedMs, 5000);
    assert.deepEqual(sample(elapsedMs, scenario.id).points, sample(elapsedMs).points, 'completed scene returns to baseline');
    assert.deepEqual(sample(elapsedMs, scenario.id, { scenarioElapsedMs: 0 }).points, sample(elapsedMs).points);
  }
});

test('all seeds/scenarios produce only finite, in-range samples with discrete state labels', () => {
  const lookup = new Map(config.channels.map(channel => [channel.id, channel]));
  const times = [0, 1, 19999, 20000, 80000, 120000, 86400000, 1e12, Number.MAX_SAFE_INTEGER - epochMs,
    ...Array.from({ length: 100 }, (_, index) => index * 73003)];
  for (const seed of [0, 2777, 0xffffffff]) for (const scenario of config.scenarios) for (const elapsedMs of times) {
    const frame = sample(elapsedMs, scenario.id, { seed, loop: true });
    for (const point of frame.points) {
      const channel = lookup.get(point.channelId)!;
      assert.ok(Number.isFinite(point.value) && point.value >= channel.range.min && point.value <= channel.range.max, channel.id);
      assert.equal(point.source, 'simulated'); assert.equal(point.deviceId, channel.deviceId);
      assert.equal(point.at, epochMs + elapsedMs);
      if (channel.kind === 'state') assert.ok(channel.valueLabels!.some(label => label.value === point.value));
    }
  }
  const saturated = structuredClone(config);
  const channel = saturated.channels.find(item => item.id === 'diesel.engine.coolant')!;
  channel.baseline = channel.range.max; channel.noise.amplitude = 0; channel.dailyAmplitude = 0;
  assert.equal(byId(simulateTelemetry(saturated, { elapsedMs: 85000, scenario: 'coolant-rise' }).points, channel.id).value, channel.range.max);
});

test('normal is a scenario name, while all alert conclusions depend exclusively on configured demo thresholds', () => {
  for (const elapsedMs of [0, 20000, 85000, 120000, 43200000, 86400000]) assert.deepEqual(sample(elapsedMs).alerts, []);
  const frame = sample(85000, 'coolant-rise'); assert.ok(frame.alerts.length > 0);
  for (const alert of frame.alerts) {
    const channel = config.channels.find(item => item.id === alert.channelId)!;
    assert.equal(alert.source, 'simulated'); assert.equal(alert.deviceId, channel.deviceId); assert.equal(alert.partId, channel.partId);
    assert.deepEqual(alert.threshold, channel.threshold); assert.equal(alert.label.zh, '仿真告警');
  }
  const noLimits = structuredClone(config); noLimits.channels.forEach(channel => { channel.threshold = null; });
  assert.deepEqual(telemetryDemoAlerts(noLimits, frame.points), []);
  const changed = structuredClone(config);
  for (const channel of changed.channels) if (channel.threshold) channel.threshold = { source: 'demo', note: DEMO_THRESHOLD_NOTE, alarm: { above: channel.range.max } };
  assert.deepEqual(telemetryDemoAlerts(changed, frame.points), [], 'changing configuration removes alerts without editing simulator code');
});

test('above/below boundaries are explicit, alarm takes precedence, and a trend-only channel never gets a conclusion', () => {
  const points = sample(0).points;
  for (const channel of config.channels.filter(item => item.threshold)) {
    const point = byId(points, channel.id), threshold = channel.threshold!;
    const boundary = threshold.alarm!.above ?? threshold.alarm!.below!;
    const onBoundary = { ...point, value: boundary };
    assert.ok(telemetryDemoAlerts(config, [onBoundary]).every(alert => alert.severity !== 'alarm'));
    const outside = { ...point, value: boundary + (threshold.alarm!.above === undefined ? -0.01 : 0.01) };
    assert.equal(telemetryDemoAlerts(config, [outside])[0].severity, 'alarm');
  }
  const unconfigured = config.channels.find(channel => channel.threshold === null)!;
  assert.deepEqual(telemetryDemoAlerts(config, [{ ...byId(points, unconfigured.id), value: unconfigured.range.max }]), []);
});

test('demo alerts reject device, unknown, cross-device, non-finite and out-of-range points without duplicate alerts', () => {
  const point = byId(sample(85000, 'coolant-rise').points, 'diesel.engine.coolant');
  const invalid: TelemetryPoint[] = [
    { ...point, source: 'device' }, { ...point, deviceId: 't70-demo' }, { ...point, channelId: 'unknown' },
    { ...point, value: Infinity }, { ...point, value: NaN }, { ...point, value: 1e9 }, { ...point, at: -1 }, { ...point, elapsedMs: NaN },
  ];
  assert.deepEqual(telemetryDemoAlerts(config, invalid), []);
  assert.equal(telemetryDemoAlerts(config, [point, point]).length, 1);
});

test('public catalog and serialized samples retain simulation provenance and omit backend generation recipes', () => {
  const catalog = telemetryCatalog(config);
  assert.equal(catalog.watermark, TELEMETRY_WATERMARK); assert.equal(catalog.seed, 2777); assert.equal(catalog.source, 'simulated');
  assert.match(catalog.note.zh, /非厂家参数/); assert.match(catalog.note.zh, /结构示意/);
  for (const channel of catalog.channels) {
    assert.equal(channel.source, 'simulated'); assert.ok(!('baseline' in channel) && !('noise' in channel) && !('dailyAmplitude' in channel));
  }
  assert.ok(catalog.scenarios.every(scenario => !('tracks' in scenario)));
  catalog.channels[0].name.zh = 'changed'; assert.notEqual(config.channels[0].name.zh, 'changed');
  assert.ok(sample(0).points.every(point => JSON.parse(JSON.stringify(point)).source === 'simulated'));
});

test('invalid seed/time/scenario arguments fail rather than producing an unlabelled or non-finite point', () => {
  for (const seed of [-1, .1, NaN, Infinity, 0x100000000]) assert.throws(() => sample(0, 'normal', { seed }), RangeError);
  for (const elapsedMs of [-1, .1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => sample(elapsedMs), RangeError);
  assert.throws(() => sample(0, 'not-a-scene' as 'normal'), RangeError);
  assert.throws(() => sample(0, 'normal', { scenarioElapsedMs: -1 }), RangeError);
  assert.throws(() => telemetryCatalog(config, -1), RangeError);
});

test('configuration rejects invalid provenance, references, status labels, thresholds and timeline bounds', () => {
  const reject = (change: (copy: TelemetryDemoConfig) => void) => {
    const copy = structuredClone(config); change(copy); assert.throws(() => validateTelemetryDemoConfig(copy), RangeError);
  };
  for (const invalid of [null, {}, [], { ...config, source: 'device' }, { ...config, note: 'manufacturer' }]) assert.throws(() => validateTelemetryDemoConfig(invalid), RangeError);
  reject(copy => { copy.seed = NaN; }); reject(copy => { copy.capacity = 100000; }); reject(copy => { copy.staleAfterMs = 100; });
  reject(copy => { copy.devices[0].source = 'device'; }); reject(copy => { copy.devices.push(copy.devices[0]); });
  reject(copy => { copy.channels.push(copy.channels[0]); }); reject(copy => { copy.channels[0].deviceId = 'unknown'; });
  reject(copy => { copy.channels[0].range.max = Infinity; }); reject(copy => { copy.channels[0].noise.periodMs = 0; });
  reject(copy => { copy.channels[0].baseline = Infinity; }); reject(copy => { copy.channels[0].precision = 100; });
  reject(copy => { copy.channels[1].threshold!.note = 'manufacturer' as typeof DEMO_THRESHOLD_NOTE; });
  reject(copy => { copy.channels[1].threshold!.alarm = { above: 10000 }; });
  reject(copy => { copy.channels[1].threshold = { source: 'demo', note: DEMO_THRESHOLD_NOTE }; });
  reject(copy => { const state = copy.channels.find(channel => channel.kind === 'state')!; state.valueLabels!.pop(); });
  reject(copy => { copy.scenarios[1].tracks[0].channelId = 'unknown'; });
  reject(copy => { copy.scenarios[1].tracks[0].keyframes[1][0] = 0; });
  reject(copy => { copy.scenarios[1].tracks[0].keyframes.at(-1)![1] = 10; });
  reject(copy => { copy.scenarios[0].tracks.push(copy.scenarios[1].tracks[0]); });
});
