import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEMO_THRESHOLD_NOTE, TELEMETRY_WATERMARK,
  type TelemetryAlert, type TelemetryCatalog, type TelemetryChannel, type TelemetryDevice,
  type TelemetryLimit, type TelemetryPoint, type TelemetryScenario, type TelemetryScenarioId, type TelemetryText,
} from '../../shared/telemetry';

interface SimulationChannel extends TelemetryChannel {
  baseline: number;
  noise: { amplitude: number; periodMs: number };
  dailyAmplitude: number;
}
interface ScenarioTrack { channelId: string; keyframes: [elapsedMs: number, offset: number][] }
interface SimulationScenario extends TelemetryScenario { tracks: ScenarioTrack[] }
export interface TelemetryDemoConfig {
  schemaVersion: 1;
  source: 'demo';
  note: typeof DEMO_THRESHOLD_NOTE;
  seed: number;
  sampleMs: number;
  heartbeatMs: number;
  staleAfterMs: number;
  /** Maximum frames retained by the later streaming runtime, not a database. */
  capacity: number;
  devices: TelemetryDevice[];
  channels: SimulationChannel[];
  scenarios: SimulationScenario[];
}
const SCENARIOS: TelemetryScenarioId[] = ['normal', 'coolant-rise', 'battery-spread', 'position-drift', 'slow-lift'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(value);
function requireConfig(condition: unknown): asserts condition {
  if (!condition) throw new RangeError('Invalid telemetry demo configuration');
}
function text(value: unknown): value is TelemetryText {
  return record(value) && [value.zh, value.en].every(part => typeof part === 'string' && part.trim().length > 0 && part.length <= 100);
}
function limit(value: unknown, min: number, max: number): value is TelemetryLimit {
  if (!record(value) || Object.keys(value).some(key => !['above', 'below'].includes(key))) return false;
  const values = Object.values(value);
  return values.length > 0 && values.every(item => finite(item) && item >= min && item <= max)
    && !(finite(value.above) && finite(value.below) && value.below >= value.above);
}

/** Reject invalid provenance, foreign sources, duplicate IDs and unsafe ranges at load time. */
export function validateTelemetryDemoConfig(input: unknown): TelemetryDemoConfig {
  requireConfig(record(input) && input.schemaVersion === 1 && input.source === 'demo' && input.note === DEMO_THRESHOLD_NOTE);
  requireConfig(Number.isInteger(input.seed) && Number(input.seed) >= 0 && Number(input.seed) <= 0xffffffff);
  requireConfig(finite(input.sampleMs) && Number.isInteger(input.sampleMs) && input.sampleMs >= 250 && input.sampleMs <= 60000);
  requireConfig(finite(input.heartbeatMs) && Number.isInteger(input.heartbeatMs) && input.heartbeatMs >= 1000 && input.heartbeatMs <= 60000);
  requireConfig(finite(input.staleAfterMs) && Number.isInteger(input.staleAfterMs) && input.staleAfterMs >= input.sampleMs * 2 && input.staleAfterMs <= 60000);
  requireConfig(finite(input.capacity) && Number.isInteger(input.capacity) && input.capacity >= 2 && input.capacity <= 3600);
  requireConfig(Array.isArray(input.devices) && input.devices.length > 0 && input.devices.length <= 16);
  requireConfig(Array.isArray(input.channels) && input.channels.length > 0 && input.channels.length <= 128);
  requireConfig(Array.isArray(input.scenarios) && input.scenarios.length === SCENARIOS.length);
  const devices = new Set<string>(), channels = new Map<string, { min: number; max: number }>();
  for (const device of input.devices) {
    requireConfig(record(device) && id(device.id) && !devices.has(device.id) && ['diesel', 't70'].includes(String(device.modelId))
      && text(device.name) && device.source === 'simulated');
    devices.add(device.id);
  }
  for (const channel of input.channels) {
    requireConfig(record(channel) && id(channel.id) && !channels.has(channel.id) && devices.has(String(channel.deviceId))
      && id(channel.partId) && text(channel.name) && typeof channel.unit === 'string' && channel.unit.length <= 16
      && channel.source === 'simulated' && ['measurement', 'state'].includes(String(channel.kind)));
    requireConfig(record(channel.range) && finite(channel.range.min) && finite(channel.range.max)
      && channel.range.min >= -1e6 && channel.range.max <= 1e6 && channel.range.min < channel.range.max);
    const { min, max } = channel.range;
    requireConfig(Number.isInteger(channel.precision) && Number(channel.precision) >= 0 && Number(channel.precision) <= 3
      && finite(channel.baseline) && channel.baseline >= min && channel.baseline <= max
      && record(channel.noise) && finite(channel.noise.amplitude) && channel.noise.amplitude >= 0 && channel.noise.amplitude <= max - min
      && finite(channel.noise.periodMs) && channel.noise.periodMs >= 1000 && channel.noise.periodMs <= 86400000
      && finite(channel.dailyAmplitude) && channel.dailyAmplitude >= 0 && channel.dailyAmplitude <= max - min);
    requireConfig(channel.threshold === null || (record(channel.threshold) && channel.threshold.source === 'demo'
      && channel.threshold.note === DEMO_THRESHOLD_NOTE && (channel.threshold.attention !== undefined || channel.threshold.alarm !== undefined)
      && (channel.threshold.attention === undefined || limit(channel.threshold.attention, min, max))
      && (channel.threshold.alarm === undefined || limit(channel.threshold.alarm, min, max))));
    if (channel.kind === 'state') {
      requireConfig(channel.precision === 0 && Number.isInteger(min) && Number.isInteger(max) && max - min <= 16
        && Array.isArray(channel.valueLabels) && channel.valueLabels.length === max - min + 1);
      const values = new Set<number>();
      for (const row of channel.valueLabels) {
        requireConfig(record(row) && finite(row.value) && Number.isInteger(row.value) && row.value >= min && row.value <= max
          && !values.has(row.value) && text(row.label));
        values.add(row.value);
      }
    } else requireConfig(channel.valueLabels === undefined);
    channels.set(channel.id, { min, max });
  }
  const scenarios = new Set<string>();
  for (const scenario of input.scenarios) {
    requireConfig(record(scenario) && SCENARIOS.includes(scenario.id as TelemetryScenarioId) && !scenarios.has(String(scenario.id))
      && text(scenario.name) && finite(scenario.durationMs) && Number.isInteger(scenario.durationMs)
      && scenario.durationMs >= 1000 && scenario.durationMs <= 86400000 && Array.isArray(scenario.tracks) && scenario.tracks.length <= channels.size);
    const seen = new Set<string>();
    for (const track of scenario.tracks) {
      requireConfig(record(track) && typeof track.channelId === 'string' && channels.has(track.channelId) && !seen.has(track.channelId)
        && Array.isArray(track.keyframes) && track.keyframes.length >= 2 && track.keyframes.length <= 32);
      seen.add(track.channelId);
      let previous = -1;
      const range = channels.get(track.channelId)!;
      for (const keyframe of track.keyframes) {
        requireConfig(Array.isArray(keyframe) && keyframe.length === 2 && finite(keyframe[0]) && Number.isInteger(keyframe[0])
          && keyframe[0] > previous && keyframe[0] <= scenario.durationMs && finite(keyframe[1]) && Math.abs(keyframe[1]) <= (range.max - range.min) * 2);
        previous = keyframe[0];
      }
      const first = track.keyframes[0], last = track.keyframes.at(-1);
      requireConfig(first[0] === 0 && first[1] === 0 && last[0] === scenario.durationMs && last[1] === 0);
    }
    requireConfig(scenario.id !== 'normal' || scenario.tracks.length === 0);
    scenarios.add(String(scenario.id));
  }
  return structuredClone(input) as unknown as TelemetryDemoConfig;
}

/** No import-time timer, environment change, HTTP listener or random side effect. */
export function loadTelemetryDemoConfig(root = process.cwd()): TelemetryDemoConfig {
  return validateTelemetryDemoConfig(JSON.parse(readFileSync(path.join(root, 'config/telemetry-demo.json'), 'utf8')));
}
export function telemetryCatalog(config: TelemetryDemoConfig, seed = config.seed): TelemetryCatalog {
  requireSeed(seed);
  return structuredClone({
    schemaVersion: 1, source: 'simulated', watermark: TELEMETRY_WATERMARK, seed,
    note: { zh: '仿真演示量程与曲线，非厂家参数；结构示意，不代表实车 CAD。', en: 'Simulated ranges and curves, not manufacturer specifications; structural schematic, not actual vehicle CAD.' },
    sampleMs: config.sampleMs, heartbeatMs: config.heartbeatMs, staleAfterMs: config.staleAfterMs,
    devices: config.devices,
    channels: config.channels.map(({ baseline: _baseline, noise: _noise, dailyAmplitude: _daily, ...channel }) => channel),
    scenarios: config.scenarios.map(({ tracks: _tracks, ...scenario }) => scenario),
  });
}
function requireSeed(seed: number) { if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Invalid telemetry seed'); }
const smooth = (fraction: number) => fraction * fraction * (3 - 2 * fraction);
/** Integer hash makes noise independent of call order and other channel counts. */
function randomUnit(seed: number, key: string): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}
function noise(seed: number, channel: SimulationChannel, elapsedMs: number): number {
  const position = elapsedMs / channel.noise.periodMs, knot = Math.floor(position);
  const left = randomUnit(seed, `${channel.id}:${knot}`), right = randomUnit(seed, `${channel.id}:${knot + 1}`);
  return (2 * (left + (right - left) * smooth(position - knot)) - 1) * channel.noise.amplitude;
}
function scenarioOffset(track: ScenarioTrack | undefined, elapsedMs: number): number {
  if (!track) return 0;
  for (let index = 1; index < track.keyframes.length; index++) {
    const [end, to] = track.keyframes[index], [start, from] = track.keyframes[index - 1];
    if (elapsedMs <= end) return from + (to - from) * smooth((elapsedMs - start) / (end - start));
  }
  return 0;
}
const exceeds = (value: number, configured: TelemetryLimit | undefined) => configured !== undefined
  && ((configured.above !== undefined && value > configured.above) || (configured.below !== undefined && value < configured.below));

/** No threshold means no alert; device/foreign/invalid points cannot enter demo alerts. */
export function telemetryDemoAlerts(config: TelemetryDemoConfig, points: TelemetryPoint[]): TelemetryAlert[] {
  const channels = new Map(config.channels.map(channel => [channel.id, channel]));
  const seen = new Set<string>(), alerts: TelemetryAlert[] = [];
  for (const point of points) {
    const channel = channels.get(point.channelId);
    if (!channel || !channel.threshold || seen.has(channel.id) || point.source !== 'simulated' || point.deviceId !== channel.deviceId
      || !Number.isSafeInteger(point.at) || point.at < 0 || !Number.isSafeInteger(point.elapsedMs) || point.elapsedMs < 0
      || !finite(point.value) || point.value < channel.range.min || point.value > channel.range.max) continue;
    seen.add(channel.id);
    const severity = exceeds(point.value, channel.threshold.alarm) ? 'alarm' : exceeds(point.value, channel.threshold.attention) ? 'attention' : null;
    if (severity) alerts.push({ id: `simulated:${channel.id}:${severity}`, channelId: channel.id, deviceId: channel.deviceId, partId: channel.partId,
      source: 'simulated', at: point.at, value: point.value, severity, label: { zh: '仿真告警', en: 'Simulated alert' }, threshold: structuredClone(channel.threshold) });
  }
  return alerts;
}

/** Pure, seeded backend simulation: baseline + smooth noise + daily cycle + scripted offsets. */
export function simulateTelemetry(config: TelemetryDemoConfig, options: {
  elapsedMs: number; epochMs?: number; seed?: number; scenario?: TelemetryScenarioId; scenarioElapsedMs?: number; loop?: boolean;
}) {
  const { elapsedMs, epochMs = 0, seed = config.seed, scenario: scenarioId = 'normal', scenarioElapsedMs = elapsedMs, loop = false } = options;
  requireSeed(seed);
  if (![elapsedMs, epochMs, scenarioElapsedMs, epochMs + elapsedMs].every(value => Number.isSafeInteger(value) && value >= 0)) throw new RangeError('Invalid telemetry time');
  const scenario = config.scenarios.find(item => item.id === scenarioId);
  if (!scenario) throw new RangeError('Unknown telemetry scenario');
  const phase = loop ? scenarioElapsedMs % scenario.durationMs : Math.min(scenarioElapsedMs, scenario.durationMs);
  const at = epochMs + elapsedMs;
  const points: TelemetryPoint[] = config.channels.map(channel => {
    const daily = Math.sin(elapsedMs / 86400000 * Math.PI * 2 + randomUnit(seed, `${channel.id}:daily`) * Math.PI * 2) * channel.dailyAmplitude;
    const offset = scenarioOffset(scenario.tracks.find(track => track.channelId === channel.id), phase);
    const raw = channel.baseline + noise(seed, channel, elapsedMs) + daily + offset;
    const rounded = Math.round(raw * 10 ** channel.precision) / 10 ** channel.precision;
    return { channelId: channel.id, deviceId: channel.deviceId, source: 'simulated', at, elapsedMs,
      value: Math.max(channel.range.min, Math.min(channel.range.max, rounded)) };
  });
  return { at, scenario: { id: scenarioId, elapsedMs: phase, loop }, points, alerts: telemetryDemoAlerts(config, points) };
}
