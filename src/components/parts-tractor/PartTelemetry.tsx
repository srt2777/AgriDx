import React, { useId, useState } from 'react';
import { Activity, Clock3, Download, FlaskConical, RefreshCw, Unplug, TriangleAlert } from 'lucide-react';
import { StatTicker } from '../StatTicker';
import { TelemetryScenarioControls } from './TelemetryScenarioControls';
import { TelemetryAlerts } from './TelemetryAlerts';
import type { SimulationTarget } from './parts-simulation';
import { useTelemetry } from '../../hooks/useTelemetry';
import { nearestTelemetryPoint, telemetryCsv, telemetryNumber, telemetryPlot, telemetryThreshold, telemetryValue, type TelemetryLanguage } from '../../features/telemetry/presentation';
import { TELEMETRY_WINDOWS, type TelemetryModelId, type TelemetryWindow } from '../../../shared/telemetry';

type TelemetryData = ReturnType<typeof useTelemetry>;
type Row = TelemetryData['series'][number];

export default function PartTelemetry({ modelId, partId, lang, onAlertSelect }: { modelId: TelemetryModelId; partId: string; lang: TelemetryLanguage; onAlertSelect?: (target: SimulationTarget) => void }) {
  const [window, setWindow] = useState<TelemetryWindow>('5m');
  const data = useTelemetry({ modelId, partId, window });
  return <TelemetryPanel data={data} lang={lang} onWindowChange={setWindow} onAlertSelect={onAlertSelect} />;
}

/** Presentational boundary also permits deterministic empty/error/accessibility acceptance tests. */
export function TelemetryPanel({ data, lang, onWindowChange, onAlertSelect }: { data: TelemetryData; lang: TelemetryLanguage; onWindowChange: (window: TelemetryWindow) => void; onAlertSelect?: (target: SimulationTarget) => void }) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const id = useId(), [cursor, setCursor] = useState<number | null>(null);
  const to = data.windowEnd;
  const starts = data.series.flatMap(row => row.windowPoints.length ? [row.windowPoints[0].at] : []);
  const from = Math.max(0, to - TELEMETRY_WINDOWS[data.window], starts.length ? Math.min(...starts) : 0);
  const at = cursor === null ? to : Math.min(to, Math.max(from, cursor));
  const hasPoints = data.series.some(row => row.windowPoints.length > 0);
  const clock = (time: number) => time > 0 ? new Date(time).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-GB', { hour12: false }) : '—';
  const state = data.connectionState;
  const unsupported = data.error === 'unsupported';
  const StateIcon = state === 'offline' ? Unplug : state === 'delayed' ? Clock3 : FlaskConical;
  const stateLabel = state === 'offline' ? t('离线', 'Offline') : state === 'delayed' ? t('延迟', 'Delayed') : t('仿真', 'Simulated');
  function download() {
    const blob = new Blob([telemetryCsv(data.series, lang)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `agridx-simulated-${data.series[0]?.channel.partId ?? 'part'}-${data.window}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="telemetry-panel" data-source="simulated" data-phase={data.phase} data-state={state} aria-label={t('部件仿真监测', 'Part simulation monitoring')} aria-live="off">
    <header className="telemetry-header">
      <h3><Activity size={16} aria-hidden="true" />{t('部件监测', 'Part monitoring')}</h3>
      <span className="telemetry-badge"><FlaskConical size={14} aria-hidden="true" />{t('仿真数据', 'Simulated data')}</span>
      <span className="telemetry-state" role="status"><StateIcon size={14} aria-hidden="true" />{stateLabel}</span>
    </header>
    <p className="telemetry-note">{t('仿真读数仅供趋势演示，不能作为实车维修依据。', 'Simulated trends only; not evidence for vehicle repairs.')}</p>
    <p className="telemetry-note">{t('阈值来源：演示配置（demo）', 'Threshold source: demo configuration (demo)')} <code>config/telemetry-demo.json</code><br />{t('仿真演示阈值,非厂家标准', 'Simulation demo thresholds, not manufacturer standards.')}</p>
    {!unsupported && <TelemetryAlerts data={data} lang={lang} onSelect={onAlertSelect} />}
    {!unsupported && <TelemetryScenarioControls data={data} lang={lang} />}
    {data.phase === 'loading' && <p role="status">{t('正在连接仿真数据…', 'Connecting to simulation data…')}</p>}
    {data.phase === 'error' && <div role="alert" className="telemetry-message"><TriangleAlert size={16} aria-hidden="true" /><p>{unsupported
      ? t('当前网页未接入仿真服务，监测数据、场景和告警不可用。', 'This website is not connected to a simulation service. Monitoring data, scenarios and alerts are unavailable.')
      : data.error === 'invalid_data' ? t('数据校验失败，连接已停止。', 'Data validation failed; connection stopped.') : t('监测连接不可用。保留的读数是末次样本；恢复后自动重连。', 'Monitoring connection unavailable. Retained readings are the last samples; reconnection is automatic.')}</p>{!unsupported && <button type="button" onClick={data.retry}><RefreshCw size={14} aria-hidden="true" />{t('重试连接', 'Retry connection')}</button>}</div>}
    {!unsupported && data.catalog && !data.series.length && <p role="status">{t('此部件未配置仿真通道。', 'No simulation channels are configured for this part.')}</p>}
    {!unsupported && data.series.length > 0 && <>
      <div className="telemetry-metrics">{data.series.map(row => <article className="telemetry-metric" key={row.channel.id}>
        <h4>{row.channel.name[lang]}</h4>
        <div className="telemetry-value">{row.channel.kind === 'state' ? telemetryValue(row.channel, row.latest, lang) : <><StatTicker value={row.latest?.value} reduced precision={row.channel.precision} locale={lang === 'zh' ? 'zh-CN' : 'en-US'} /><small>{row.channel.unit}</small></>}</div>
        <p className="telemetry-age">{row.latest ? <>{state === 'simulated' ? t('采样于', 'Sampled at') : t('末次样本', 'Last sample')} <time dateTime={new Date(row.latest.at).toISOString()}>{clock(row.latest.at)}</time> · {Math.max(0, Math.floor((data.now - row.latest.at) / 1000))}{t('秒前', 's ago')}</> : t('暂无样本', 'No samples yet')}</p>
        <MiniTrend row={row} sampleMs={data.catalog!.sampleMs} />
        <p className="telemetry-threshold">{telemetryThreshold(row.channel, lang)}</p>
      </article>)}</div>
      <div className="telemetry-window" role="group" aria-label={t('趋势时间窗', 'Trend time window')}>{(['5m', '15m', '1h'] as const).map(window => <button type="button" key={window} aria-pressed={data.window === window} onClick={() => { setCursor(null); onWindowChange(window); }}>{window === '1h' ? t('1小时', '1 hour') : window === '5m' ? t('5分钟', '5 min') : t('15分钟', '15 min')}</button>)}</div>
      {data.series.some(row => row.historyStatus === 'loading') && <p role="status">{t('历史加载中；先显示已收到的样本。', 'Loading history; showing received samples meanwhile.')}</p>}
      {data.series.filter(row => row.historyStatus === 'error').map(row => <div className="telemetry-message" role="alert" key={row.channel.id}><TriangleAlert size={14} aria-hidden="true" /><p>{row.channel.name[lang]} · {t('历史读取失败，当前趋势可能不完整。', 'History failed; the current trend may be incomplete.')}</p><button type="button" onClick={() => void data.retryHistory(row.channel.id)}>{t('重试历史', 'Retry history')}</button></div>)}
      {!hasPoints && <p role="status">{t('当前时间窗暂无数据，未推测读数。', 'No data in this time window. No readings are estimated.')}</p>}
      {hasPoints && <figure className="telemetry-chart" aria-labelledby={`${id}-title`}>
        <figcaption id={`${id}-title`}>{t('多通道趋势 · 仿真数据', 'Channel trends · Simulated data')}</figcaption>
        <p id={`${id}-help`}>{t('各通道分轨显示。悬停、触摸或用滑块方向键读数；文字读数见数据表。', 'Separate tracks. Hover, touch, or use the slider arrow keys. Text readings are in the table.')}</p>
        <svg viewBox={`0 0 360 ${data.series.length * 76 + 20}`} role="img" aria-label={t('各通道趋势；读数见下方数据表', 'Channel trends; readings are available in the table below')}
          onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); const fraction = ((event.clientX - rect.left) / rect.width * 360 - 16) / 328; setCursor(from + Math.min(1, Math.max(0, fraction)) * (to - from)); }} onPointerLeave={() => setCursor(null)}>
          {data.series.map((row, index) => {
            const plot = telemetryPlot(row.chartPoints, from, to, data.catalog!.sampleMs, row.channel.kind === 'state');
            return <g key={row.channel.id} transform={`translate(0 ${index * 76})`}>
              <text x="16" y="10">{row.channel.name[lang]}{row.channel.unit ? ` (${row.channel.unit})` : ''}</text>
              <path className="telemetry-grid" d="M16,30 H344 M16,46 H344" />
              {plot.paths.map((path, part) => <path key={part} d={path} className="telemetry-line" />)}
              {plot.marker && <circle cx={plot.marker.x} cy={plot.marker.y} r="2.5" className="telemetry-dot" />}
              <text x="16" y="64">{plot.low === null ? t('暂无数据', 'No data') : `${telemetryNumber(plot.low, row.channel.precision, lang)} — ${telemetryNumber(plot.high!, row.channel.precision, lang)}`}</text>
              {cursor !== null && <path className="telemetry-cursor" d={`M${16 + (to > from ? (at - from) / (to - from) : 1) * 328},14 v34`} />}
            </g>;
          })}
          <text x="16" y={data.series.length * 76 + 14}>{clock(from)}</text><text x="344" textAnchor="end" y={data.series.length * 76 + 14}>{clock(to)}</text>
        </svg>
        <label className="telemetry-cursor-control">{t('趋势读数位置', 'Trend reading position')}<input type="range" min={from} max={Math.max(from + 1, to)} step={data.catalog!.sampleMs} value={at} disabled={from === to} aria-describedby={`${id}-help`} aria-valuetext={clock(at)} onFocus={() => setCursor(at)} onChange={event => setCursor(Number(event.target.value))} /></label>
        <p>{t('截至', 'Through')} {clock(to)} · {data.series.length}{t('路；仅显示已有仿真样本。趋势保留峰值，缺口断线；原始点见导出。', ' tracks; buffered simulation samples only. Peaks are retained and gaps break the line. Export contains original samples.')}</p>
      </figure>}
      <details className="telemetry-table"><summary>{t('数据表与读数（仿真数据）', 'Data table and readings (simulated)')}</summary>
        <table><caption>{cursor === null ? t('末次样本与本窗范围', 'Last samples and window ranges') : `${t('查看位置', 'Reading position')} ${clock(at)}`}</caption><thead><tr><th scope="col">{t('通道', 'Channel')}</th><th scope="col">{t('原始读数与采样时间', 'Original reading and sample time')}</th></tr></thead><tbody>{data.series.map(row => {
          const point = cursor === null ? row.latest : nearestTelemetryPoint(row.windowPoints, at);
          const values = row.windowPoints.map(item => item.value);
          return <tr key={row.channel.id}><th scope="row">{row.channel.name[lang]}</th><td>{telemetryValue(row.channel, point, lang)}<br />{point ? <time dateTime={new Date(point.at).toISOString()}>{clock(point.at)}</time> : '—'}<br />{values.length > 0 && <small>{t('本窗范围', 'Window range')} {telemetryNumber(Math.min(...values), row.channel.precision, lang)} — {telemetryNumber(Math.max(...values), row.channel.precision, lang)} {row.channel.unit}</small>}</td></tr>;
        })}</tbody></table>
      </details>
      <button type="button" className="telemetry-export" disabled={!hasPoints} onClick={download}><Download size={14} aria-hidden="true" />{t('导出本窗仿真CSV', 'Export simulated window CSV')}</button>
    </>}
  </section>;
}

function MiniTrend({ row, sampleMs }: { row: Row; sampleMs: number }) {
  const points = row.chartPoints, plot = telemetryPlot(points, points[0]?.at ?? 0, points.at(-1)?.at ?? 0, sampleMs, row.channel.kind === 'state');
  return <svg className="telemetry-sparkline" viewBox="0 0 360 56" aria-hidden="true">{plot.paths.map((path, index) => <path className="telemetry-line" key={index} d={path} />)}{plot.marker && <circle cx={plot.marker.x} cy={plot.marker.y} r="3" className="telemetry-dot" />}</svg>;
}
