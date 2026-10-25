/** Monitoring is isolated from knowledge, coverage statistics and chat requests. */
export type TelemetrySource = 'simulated' | 'device';
export type TelemetryModelId = 'diesel' | 't70';
export interface TelemetryText { zh: string; en: string }
export const TELEMETRY_WATERMARK = '仿真数据 / Simulated data' as const;
export const DEMO_THRESHOLD_NOTE = '仿真演示阈值,非厂家标准' as const;

export interface TelemetryDevice {
  id: string;
  modelId: TelemetryModelId;
  name: TelemetryText;
  source: TelemetrySource;
}
export interface TelemetryLimit { above?: number; below?: number }
export interface TelemetryDemoThreshold {
  source: 'demo';
  note: typeof DEMO_THRESHOLD_NOTE;
  attention?: TelemetryLimit;
  alarm?: TelemetryLimit;
}
export interface TelemetryChannel {
  /** Globally unique channel ID; a part is scoped by deviceId + partId. */
  id: string;
  deviceId: string;
  partId: string;
  name: TelemetryText;
  unit: string;
  source: TelemetrySource;
  kind: 'measurement' | 'state';
  range: { min: number; max: number };
  precision: number;
  valueLabels?: { value: number; label: TelemetryText }[];
  /** null means trends only: never infer a normal/abnormal conclusion. */
  threshold: TelemetryDemoThreshold | null;
}
export interface TelemetryPoint {
  channelId: string;
  deviceId: string;
  source: TelemetrySource;
  /** Unix milliseconds; elapsedMs is separate from wall-clock time. */
  at: number;
  elapsedMs: number;
  value: number;
}
export interface TelemetryAlert {
  id: string;
  channelId: string;
  deviceId: string;
  partId: string;
  source: 'simulated';
  at: number;
  value: number;
  severity: 'attention' | 'alarm';
  label: { zh: '仿真告警'; en: 'Simulated alert' };
  threshold: TelemetryDemoThreshold;
}
export type TelemetryScenarioId = 'normal' | 'coolant-rise' | 'battery-spread' | 'position-drift' | 'slow-lift';
export interface TelemetryScenario {
  id: TelemetryScenarioId;
  name: TelemetryText;
  durationMs: number;
}
export interface TelemetryScenarioCommand {
  expectedRunId: string;
  revision: number;
  id: TelemetryScenarioId;
  loop: boolean;
}
export interface TelemetryScenarioState {
  schemaVersion: 1;
  source: 'simulated';
  watermark: typeof TELEMETRY_WATERMARK;
  scope: 'shared-service';
  runId: string;
  revision: number;
  id: TelemetryScenarioId;
  loop: boolean;
  startedAt: number;
  elapsedMs: number;
}
export interface TelemetryCatalog {
  schemaVersion: 1;
  source: 'simulated';
  watermark: typeof TELEMETRY_WATERMARK;
  note: TelemetryText;
  seed: number;
  sampleMs: number;
  heartbeatMs: number;
  staleAfterMs: number;
  devices: TelemetryDevice[];
  channels: TelemetryChannel[];
  scenarios: TelemetryScenario[];
}
export interface TelemetryFrame {
  schemaVersion: 1;
  source: 'simulated';
  watermark: typeof TELEMETRY_WATERMARK;
  runId: string;
  sequence: number;
  at: number;
  /** Control metadata is optional for compatibility with pure generator snapshots. */
  scenario: { id: TelemetryScenarioId; elapsedMs: number; loop: boolean; revision?: number; startedAt?: number };
  points: TelemetryPoint[];
  alerts: TelemetryAlert[];
}
export const TELEMETRY_WINDOWS = { '5m': 300000, '15m': 900000, '1h': 3600000 } as const;
export type TelemetryWindow = keyof typeof TELEMETRY_WINDOWS;
export interface TelemetryHistory {
  schemaVersion: 1;
  source: 'simulated';
  watermark: typeof TELEMETRY_WATERMARK;
  runId: string;
  channel: TelemetryChannel;
  window: TelemetryWindow;
  from: number;
  to: number;
  points: TelemetryPoint[];
}
export type TelemetryResetReason = 'server_restart' | 'history_expired' | 'cursor_ahead';
export interface TelemetryHeartbeat {
  schemaVersion: 1;
  source: 'simulated';
  watermark: typeof TELEMETRY_WATERMARK;
  at: number;
}
/** Only new samples update receivedAt; SSE heartbeats must not hide stale measurements. */
export function telemetryConnectionState(source: TelemetrySource, connected: boolean, receivedAt: number | null, now: number, staleAfterMs: number): 'simulated' | 'live' | 'delayed' | 'offline' {
  if (!connected) return 'offline';
  if (receivedAt === null || !Number.isFinite(receivedAt) || !Number.isFinite(now) || !Number.isFinite(staleAfterMs)
    || staleAfterMs <= 0 || now < receivedAt || now - receivedAt > staleAfterMs) return 'delayed';
  return source === 'device' ? 'live' : 'simulated';
}
