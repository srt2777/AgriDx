import { isRecord } from '../../lib/api-client';
import { DEMO_THRESHOLD_NOTE, TELEMETRY_WATERMARK, TELEMETRY_WINDOWS,
  type TelemetryCatalog, type TelemetryChannel, type TelemetryDemoThreshold, type TelemetryFrame,
  type TelemetryHistory, type TelemetryModelId, type TelemetryPoint, type TelemetryWindow } from '../../../shared/telemetry';

const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => number(value) && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(value);
const text = (value: unknown) => isRecord(value) && [value.zh, value.en].every(item => typeof item === 'string' && item.length > 0 && item.length <= 200);
function requireData(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid telemetry response'); }
const marked = (value: unknown): value is Record<string, unknown> => isRecord(value) && value.schemaVersion === 1 && value.source === 'simulated' && value.watermark === TELEMETRY_WATERMARK;
function threshold(value: unknown, min: number, max: number) {
  if (value === null) return true;
  if (!isRecord(value) || value.source !== 'demo' || value.note !== DEMO_THRESHOLD_NOTE || (!value.attention && !value.alarm)) return false;
  return [value.attention, value.alarm].every(level => level === undefined || (isRecord(level) && Object.keys(level).length > 0
    && Object.entries(level).every(([key, bound]) => ['above', 'below'].includes(key) && number(bound) && bound >= min && bound <= max)));
}
function channel(value: unknown): value is TelemetryChannel {
  if (!isRecord(value) || !id(value.id) || !id(value.deviceId) || !id(value.partId) || !text(value.name)
    || value.source !== 'simulated' || typeof value.unit !== 'string' || value.unit.length > 16 || !['measurement', 'state'].includes(String(value.kind))
    || !isRecord(value.range) || !number(value.range.min) || !number(value.range.max) || value.range.min >= value.range.max
    || !integer(value.precision) || value.precision > 3 || !threshold(value.threshold, value.range.min, value.range.max)) return false;
  if (value.kind === 'measurement') return value.valueLabels === undefined;
  const range = value.range as { min: number; max: number };
  return value.precision === 0 && Array.isArray(value.valueLabels) && value.valueLabels.length > 0 && value.valueLabels.length <= 17
    && Number.isInteger(range.min) && Number.isInteger(range.max) && value.valueLabels.length === range.max - range.min + 1
    && new Set(value.valueLabels.map(row => isRecord(row) ? row.value : null)).size === value.valueLabels.length
    && value.valueLabels.every(row => isRecord(row) && number(row.value) && Number.isInteger(row.value)
      && row.value >= range.min && row.value <= range.max && text(row.label));
}
export function parseTelemetryCatalog(value: unknown): TelemetryCatalog {
  requireData(marked(value) && integer(value.seed) && value.seed <= 0xffffffff && text(value.note)
    && integer(value.sampleMs) && value.sampleMs >= 250 && value.sampleMs <= 60000
    && integer(value.heartbeatMs) && value.heartbeatMs >= 1000 && value.heartbeatMs <= 60000
    && integer(value.staleAfterMs) && value.staleAfterMs >= value.sampleMs * 2 && value.staleAfterMs <= 60000
    && Array.isArray(value.devices) && value.devices.length > 0 && value.devices.length <= 16
    && Array.isArray(value.channels) && value.channels.length > 0 && value.channels.length <= 128
    && Array.isArray(value.scenarios) && value.scenarios.length === 5);
  const devices = value.devices;
  requireData(devices.every(device => isRecord(device) && id(device.id) && text(device.name) && device.source === 'simulated' && ['diesel', 't70'].includes(String(device.modelId)))
    && new Set(value.devices.map(device => device.id)).size === value.devices.length
    && value.channels.every(channel) && new Set(value.channels.map(item => item.id)).size === value.channels.length
    && value.channels.every(item => devices.some(device => device.id === item.deviceId))
    && value.scenarios.every(item => isRecord(item) && ['normal', 'coolant-rise', 'battery-spread', 'position-drift', 'slow-lift'].includes(String(item.id)) && text(item.name) && integer(item.durationMs) && item.durationMs > 0)
    && new Set(value.scenarios.map(item => item.id)).size === 5);
  return structuredClone(value) as unknown as TelemetryCatalog;
}
function point(value: unknown, definition: TelemetryChannel): value is TelemetryPoint {
  return isRecord(value) && value.channelId === definition.id && value.deviceId === definition.deviceId && value.source === 'simulated'
    && integer(value.at) && integer(value.elapsedMs) && number(value.value) && value.value >= definition.range.min && value.value <= definition.range.max
    && (definition.kind !== 'state' || definition.valueLabels!.some(label => label.value === value.value));
}
const sameThreshold = (a: TelemetryDemoThreshold, b: TelemetryDemoThreshold) => a.source === b.source && a.note === b.note
  && (['attention', 'alarm'] as const).every(level => (['above', 'below'] as const).every(bound => a[level]?.[bound] === b[level]?.[bound]));
export function parseTelemetryFrame(value: unknown, catalog: TelemetryCatalog): TelemetryFrame {
  const scenario = isRecord(value) ? value.scenario : null;
  requireData(marked(value) && typeof value.runId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value.runId)
    && integer(value.sequence) && value.sequence > 0 && integer(value.at) && isRecord(scenario)
    && catalog.scenarios.some(item => item.id === scenario.id) && integer(scenario.elapsedMs) && typeof scenario.loop === 'boolean'
    && Array.isArray(value.points) && value.points.length === catalog.channels.length && Array.isArray(value.alerts) && value.alerts.length <= catalog.channels.length);
  const points = new Map<string, TelemetryPoint>();
  for (const row of value.points) {
    const definition = catalog.channels.find(item => isRecord(row) && item.id === row.channelId);
    requireData(definition && point(row, definition) && row.at === value.at && !points.has(row.channelId)); points.set(row.channelId, row);
  }
  const seen = new Set<string>();
  for (const alert of value.alerts) {
    requireData(isRecord(alert) && typeof alert.channelId === 'string');
    const definition = catalog.channels.find(item => item.id === alert.channelId), sample = points.get(alert.channelId);
    requireData(definition?.threshold && sample && !seen.has(alert.channelId) && typeof alert.id === 'string' && alert.id.length <= 150
      && alert.source === 'simulated' && alert.deviceId === definition.deviceId && alert.partId === definition.partId
      && alert.at === value.at && alert.value === sample.value && ['attention', 'alarm'].includes(String(alert.severity))
      && isRecord(alert.label) && alert.label.zh === '仿真告警' && alert.label.en === 'Simulated alert'
      && threshold(alert.threshold, definition.range.min, definition.range.max) && alert.threshold !== null
      && sameThreshold(alert.threshold as TelemetryDemoThreshold, definition.threshold));
    seen.add(alert.channelId);
  }
  return structuredClone(value) as unknown as TelemetryFrame;
}
export function parseTelemetryHistory(value: unknown, catalog: TelemetryCatalog, channelId: string, window: TelemetryWindow): TelemetryHistory {
  const definition = catalog.channels.find(item => item.id === channelId);
  requireData(definition && marked(value) && typeof value.runId === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value.runId)
    && value.window === window && channel(value.channel) && value.channel.id === channelId && value.channel.deviceId === definition.deviceId
    && integer(value.from) && integer(value.to) && value.from <= value.to && value.to - value.from <= TELEMETRY_WINDOWS[window]
    && Array.isArray(value.points) && value.points.length <= 3600);
  let previous = -1;
  for (const row of value.points) {
    requireData(point(row, definition) && row.at >= value.from && row.at <= value.to && row.at > previous); previous = row.at;
  }
  // Channel metadata comes from the validated stream catalogue, never from a foreign history response.
  return { ...(structuredClone(value) as unknown as TelemetryHistory), channel: structuredClone(definition) };
}
export function parseTelemetryEvent(raw: string): unknown {
  requireData(raw.length <= 262144);
  return JSON.parse(raw);
}
/** Select real samples, retaining first/last and each bucket's extrema; never invent averages. */
export function downsampleTelemetry(points: readonly TelemetryPoint[], maximum = 240): TelemetryPoint[] {
  if (!Number.isSafeInteger(maximum) || maximum < 4) throw new RangeError('Invalid telemetry sample limit');
  if (points.length <= maximum) return [...points];
  const buckets = Math.floor((maximum - 2) / 2), selected = [points[0]];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor(bucket * (points.length - 2) / buckets), end = 1 + Math.floor((bucket + 1) * (points.length - 2) / buckets);
    let min = start, max = start;
    for (let index = start + 1; index < end; index++) { if (points[index].value < points[min].value) min = index; if (points[index].value > points[max].value) max = index; }
    selected.push(...(min === max ? [points[min]] : [Math.min(min, max), Math.max(min, max)].map(index => points[index])));
  }
  selected.push(points.at(-1)!); return selected;
}
export function mergeTelemetryPoints(left: readonly TelemetryPoint[], right: readonly TelemetryPoint[]): TelemetryPoint[] {
  if (!left.length) return [...right].slice(-3600);
  if (!right.length) return [...left].slice(-3600);
  if (left.at(-1)!.at < right[0].at) return [...left, ...right].slice(-3600);
  if (right.length === 1 && left.at(-1)!.at === right[0].at) return [...left.slice(0, -1), right[0]];
  return [...new Map([...left, ...right].map(point => [point.at, point])).values()].sort((a, b) => a.at - b.at).slice(-3600);
}
export interface TelemetryScope { modelId?: TelemetryModelId; partId?: string; channelIds?: readonly string[] }
/** Window before downsampling so a short window does not inherit the one-hour resolution. */
export function telemetryWindowPoints(points: readonly TelemetryPoint[], window: TelemetryWindow, to: number): TelemetryPoint[] {
  return points.filter(point => point.at >= to - TELEMETRY_WINDOWS[window] && point.at <= to);
}
export function selectTelemetryChannels(catalog: TelemetryCatalog | null, scope: TelemetryScope): TelemetryChannel[] {
  const ids = new Set(scope.channelIds ?? []);
  return (catalog?.channels ?? []).filter(channel => {
    const device = catalog!.devices.find(item => item.id === channel.deviceId)!;
    return (ids.size ? ids.has(channel.id) : !!scope.modelId && !!scope.partId)
      && (!scope.modelId || device.modelId === scope.modelId) && (!scope.partId || channel.partId === scope.partId);
  }).slice(0, 4);
}
