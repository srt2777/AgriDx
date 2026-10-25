import { TELEMETRY_WATERMARK, type TelemetryChannel, type TelemetryPoint } from '../../../shared/telemetry';

export type TelemetryLanguage = 'zh' | 'en';
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
/** CSV keeps original samples, scope and simulation provenance; text cells cannot become formulas. */
export function telemetryCsv(rows: readonly { channel: TelemetryChannel; windowPoints: readonly TelemetryPoint[] }[], lang: TelemetryLanguage): string {
  const cell = (value: string | number) => `"${(typeof value === 'number' ? String(value) : value.replace(/^\s*[=+@-]/, "'$&")).replaceAll('"', '""')}"`;
  const table: (string | number)[][] = [['watermark', 'source', 'device_id', 'channel_id', 'part_id', 'channel', 'at', 'value', 'unit', 'threshold_source', 'threshold_note']];
  for (const { channel, windowPoints } of rows) for (const point of windowPoints) table.push([
    TELEMETRY_WATERMARK, point.source, point.deviceId, point.channelId, channel.partId, channel.name[lang],
    new Date(point.at).toISOString(), point.value, channel.unit, channel.threshold?.source ?? '', channel.threshold?.note ?? '',
  ]);
  return '\uFEFF' + table.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
