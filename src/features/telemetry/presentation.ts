import { TELEMETRY_WATERMARK, type TelemetryChannel, type TelemetryPoint } from '../../../shared/telemetry';
import type { TelemetryHistoryStatus } from './store';

export type { TelemetryHistoryStatus };
export type TelemetryLanguage = 'zh' | 'en';
/** A history request that returned successfully but found no samples is 'empty', never 'ready'. */
export function historyStatusLabel(status: TelemetryHistoryStatus, lang: TelemetryLanguage): string {
  return status === 'loading' ? (lang === 'zh' ? '历史加载中' : 'Loading history')
    : status === 'ready' ? (lang === 'zh' ? '历史请求已完成' : 'History request completed')
    : status === 'empty' ? (lang === 'zh' ? '历史请求已完成 · 暂无样本' : 'History request completed · no samples yet')
    : (lang === 'zh' ? '历史读取失败' : 'History request failed');
}
export interface TelemetryHistoryExportEntry { channelId: string; label: string; status: TelemetryHistoryStatus; samples: number }
export interface TelemetryHistoryExportMeta { runId: string | null; window: string; source: string; mode: 'live' | 'snapshot'; capturedAt: number | null }
export interface TelemetryHistoryExport extends TelemetryHistoryExportMeta { entries: readonly TelemetryHistoryExportEntry[] }
const csvCell = (value: string | number) => `"${(typeof value === 'number' ? String(value) : value.replace(/^\s*[=+@-]/, "'$&")).replaceAll('"', '""')}"`;
/**
 * Status section appended to an export, after the original sample rows. Every selected channel
 * appears once, including zero-sample failed channels; the incomplete list names only channels
 * whose history is still loading or failed. 'Completed' only means the request returned, never
 * that the window has no gaps or that the data is verified.
 */
export function historyStatusCsvSection(entries: readonly TelemetryHistoryExportEntry[], meta: TelemetryHistoryExportMeta, lang: TelemetryLanguage): string {
  const lines: (string | number)[][] = [[
    'history_status', 'channel_id', 'channel', 'samples', 'status', 'status_text',
  ]];
  for (const entry of entries) lines.push(['history_status', entry.channelId, entry.label, entry.samples, entry.status, historyStatusLabel(entry.status, lang)]);
  const count = (status: TelemetryHistoryStatus) => entries.filter(entry => entry.status === status).length;
  lines.push(['history_summary', 'run_id', 'window', 'source', 'mode', 'captured_at', 'ready', 'empty', 'loading', 'error']);
  lines.push(['history_summary', meta.runId ?? '', meta.window, meta.source, meta.mode,
    meta.capturedAt === null ? '' : new Date(meta.capturedAt).toISOString(), count('ready'), count('empty'), count('loading'), count('error')]);
  const incomplete = entries.filter(entry => entry.status === 'loading' || entry.status === 'error');
  if (incomplete.length) {
    lines.push(['history_incomplete', 'channel_id', 'channel', 'status']);
    for (const entry of incomplete) lines.push(['history_incomplete', entry.channelId, entry.label, entry.status]);
  }
  return '\r\n' + lines.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export interface TelemetrySnapshotCapture<Row> {
  rows: Row[];
  history: Record<string, TelemetryHistoryStatus>;
  samples: Record<string, number>;
  capturedAt: number;
  runId: string | null;
  window: string;
}
/** Deep-copy rows and history state at freeze time; later live retries must not rewrite a frozen snapshot. */
export function freezeTelemetrySnapshot<Row>(input: { rows: readonly Row[]; history: Record<string, TelemetryHistoryStatus>;
  samples: Record<string, number>; capturedAt: number; runId: string | null; window: string }): TelemetrySnapshotCapture<Row> {
  return { rows: structuredClone(input.rows) as Row[], history: { ...input.history }, samples: { ...input.samples },
    capturedAt: input.capturedAt, runId: input.runId, window: input.window };
}
export function telemetryNumber(value: number, precision: number, lang: TelemetryLanguage): string {
  return value.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}
export function telemetryValue(channel: TelemetryChannel, point: TelemetryPoint | undefined, lang: TelemetryLanguage): string {
  if (!point) return '—';
  return channel.kind === 'state' ? channel.valueLabels?.find(row => row.value === point.value)?.label[lang] ?? '—'
    : `${telemetryNumber(point.value, channel.precision, lang)}${channel.unit ? ` ${channel.unit}` : ''}`;
}
export function telemetryThreshold(channel: TelemetryChannel, lang: TelemetryLanguage): string {
  if (!channel.threshold) return lang === 'zh' ? '未配置阈值 · 仅显示趋势' : 'No threshold configured · trends only';
  return (['attention', 'alarm'] as const).flatMap(level => {
    const limit = channel.threshold![level];
    return (['above', 'below'] as const).flatMap(bound => limit?.[bound] === undefined ? [] : [
      `${lang === 'zh' ? (level === 'attention' ? '演示关注' : '演示告警') : (level === 'attention' ? 'Demo attention' : 'Demo alarm')} ${bound === 'above' ? '>' : '<'} ${telemetryNumber(limit[bound]!, channel.precision, lang)} ${channel.unit}`.trim(),
    ]);
  }).join(' · ');
}
export function nearestTelemetryPoint(points: readonly TelemetryPoint[], at: number): TelemetryPoint | undefined {
  if (!points.length) return undefined;
  let left = 0, right = points.length - 1;
  while (left < right) { const middle = Math.floor((left + right) / 2); if (points[middle].at < at) left = middle + 1; else right = middle; }
  return left > 0 && Math.abs(points[left - 1].at - at) <= Math.abs(points[left].at - at) ? points[left - 1] : points[left];
}
/** Geometry only: input samples have already been windowed/downsampled by useTelemetry. */
export function telemetryPlot(points: readonly TelemetryPoint[], from: number, to: number, sampleMs: number, stepped = false) {
  if (!points.length) return { paths: [] as string[], low: null, high: null, marker: null };
  const values = points.map(point => point.value), low = Math.min(...values), high = Math.max(...values);
  const paths: string[] = []; let previous: TelemetryPoint | undefined, marker: { x: number; y: number } | null = null;
  for (const point of points) {
    const x = 16 + (to > from ? (point.at - from) / (to - from) : 0.5) * 328;
    const y = 46 - (high > low ? (point.value - low) / (high - low) : 0.5) * 32;
    marker = { x, y };
    const start = !previous || point.at - previous.at > sampleMs * 3;
    const command = `${start ? 'M' : stepped ? 'H' : 'L'}${x.toFixed(2)}${!start && stepped ? ' V' : ','}${y.toFixed(2)}`;
    if (start) paths.push(command); else paths[paths.length - 1] += ` ${command}`;
    previous = point;
  }
  return { paths, low, high, marker };
}
/** CSV keeps original samples, scope and simulation provenance; text cells cannot become formulas.
 * With `options.history`, a history-status section is appended after the sample rows; without it
 * the output is exactly the original one-header-plus-samples shape. */
export function telemetryCsv(rows: readonly { channel: TelemetryChannel; windowPoints: readonly TelemetryPoint[] }[], lang: TelemetryLanguage,
  options?: { history?: TelemetryHistoryExport }): string {
  const table: (string | number)[][] = [['watermark', 'source', 'device_id', 'channel_id', 'part_id', 'channel', 'at', 'value', 'unit', 'threshold_source', 'threshold_note']];
  for (const { channel, windowPoints } of rows) for (const point of windowPoints) table.push([
    TELEMETRY_WATERMARK, point.source, point.deviceId, point.channelId, channel.partId, channel.name[lang],
    new Date(point.at).toISOString(), point.value, channel.unit, channel.threshold?.source ?? '', channel.threshold?.note ?? '',
  ]);
  const body = '\uFEFF' + table.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return options?.history ? body + historyStatusCsvSection(options.history.entries, options.history, lang) : body;
}
