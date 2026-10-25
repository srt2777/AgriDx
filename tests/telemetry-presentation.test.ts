import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog } from '../server/telemetry/simulator';
import { TELEMETRY_WATERMARK } from '../shared/telemetry';
import { downsampleTelemetry, telemetryWindowPoints } from '../src/features/telemetry/protocol';
import { EMPTY_TELEMETRY } from '../src/features/telemetry/store';
import { nearestTelemetryPoint, telemetryCsv, telemetryNumber, telemetryPlot, telemetryThreshold, telemetryValue } from '../src/features/telemetry/presentation';
import { TelemetryPanel } from '../src/components/parts-tractor/PartTelemetry';
import { StatTicker } from '../src/components/StatTicker';
import type { useTelemetry } from '../src/hooks/useTelemetry';

const config = loadTelemetryDemoConfig(), catalog = telemetryCatalog(config), startAt = Date.UTC(2026, 9, 25);
const sample = (elapsedMs: number) => simulateTelemetry(config, { elapsedMs, epochMs: startAt }).points;
const definitions = catalog.channels.filter(channel => channel.partId === 'battery_box');
function fixture(): ReturnType<typeof useTelemetry> {
  const points = [sample(0), sample(1000), sample(2000)];
  return { ...EMPTY_TELEMETRY, catalog, phase: 'ready', connected: true, now: startAt + 2000, receivedAt: startAt + 2000,
    runId: 'presentation-run', sequence: 3, window: '5m', windowEnd: startAt + 2000, connectionState: 'simulated',
    series: definitions.map(channel => { const values = points.map(frame => frame.find(point => point.channelId === channel.id)!);
      return { channel, points: values, windowPoints: values, chartPoints: values, latest: values.at(-1), historyStatus: 'ready' };
    }), retry: () => {}, retryHistory: async () => {},
  };
}
const render = (data: ReturnType<typeof useTelemetry>, lang: 'zh' | 'en' = 'zh') => renderToStaticMarkup(React.createElement(TelemetryPanel, { data, lang, onWindowChange: () => {} }));

test('time windows precede sampling and retain only actual points, including boundary and peak samples', () => {
  const channel = definitions[0];
  const points = Array.from({ length: 3600 }, (_, index) => ({ ...sample(0).find(point => point.channelId === channel.id)!, at: startAt + index * 1000, value: index === 3500 ? 80 : 20 }));
  const short = telemetryWindowPoints(points, '5m', startAt + 3599000);
  assert.equal(short.length, 301); assert.equal(short[0], points[3299]); assert.equal(short.at(-1), points.at(-1));
  const sampled = downsampleTelemetry(short); assert.ok(sampled.length <= 240); assert.ok(sampled.includes(points[3500]));
  assert.ok(sampled.every(point => short.includes(point)), 'no averaged or invented chart values');
  assert.equal(telemetryWindowPoints(points, '1h', startAt + 3599000).length, 3600);
  assert.equal(telemetryWindowPoints(points, '5m', startAt - 1).length, 0);
});

test('hover and keyboard positions resolve to original samples with bounded edge and gap handling', () => {
  const points = fixture().series[0].points;
  assert.equal(nearestTelemetryPoint([], startAt), undefined);
  assert.equal(nearestTelemetryPoint(points, startAt - 100000), points[0]);
  assert.equal(nearestTelemetryPoint(points, startAt + 999999), points.at(-1));
  assert.equal(nearestTelemetryPoint(points, startAt + 600), points[1]);
  assert.equal(nearestTelemetryPoint(points, startAt + 500), points[0]);
});

test('geometry separates sampling gaps, uses step segments for state channels and handles constant or single samples', () => {
  const original = fixture().series[0].points, snapshot = structuredClone(original);
  const points = [...original, { ...original.at(-1)!, at: startAt + 10000, value: 30 }];
  const plot = telemetryPlot(points, startAt, startAt + 10000, 1000);
  assert.equal(plot.paths.length, 2); assert.equal(plot.marker?.x, 344); assert.equal(plot.high, 30);
  assert.ok(plot.paths.every(path => !/NaN|Infinity/.test(path)));
  const step = telemetryPlot(original, startAt, startAt + 2000, 1000, true);
  assert.match(step.paths[0], / H/); assert.match(step.paths[0], / V/); assert.doesNotMatch(step.paths[0], / L/);
  const single = telemetryPlot([original[0]], startAt, startAt, 1000);
  assert.equal(single.marker?.x, 180); assert.equal(single.marker?.y, 30);
  assert.deepEqual(telemetryPlot([], 0, 0, 1000), { paths: [], low: null, high: null, marker: null });
  assert.deepEqual(original, snapshot);
});

test('configured precision and state labels survive display; missing thresholds cannot acquire a conclusion', () => {
  assert.equal(telemetryNumber(119.07, 2, 'en'), '119.07');
  const state = catalog.channels.find(channel => channel.id === 't70.gps.status')!;
  const point = { ...sample(0).find(point => point.channelId === state.id)!, value: 2 };
  assert.equal(telemetryValue(state, point, 'zh'), '定位漂移');
  assert.equal(telemetryValue(state, point, 'en'), 'Position drift');
  assert.equal(telemetryValue(state, undefined, 'zh'), '—');
  assert.equal(telemetryThreshold(state, 'zh'), '未配置阈值 · 仅显示趋势');
  assert.doesNotMatch(telemetryThreshold(state, 'zh'), /正常|异常/);
  assert.match(telemetryThreshold(definitions[2], 'en'), /Demo attention > 0\.600 V.*Demo alarm > 1\.000 V/);
  const ticker = renderToStaticMarkup(React.createElement(StatTicker, { value: 119.07, reduced: true, precision: 2, locale: 'en-US' }));
  assert.match(ticker, />119\.07</); assert.doesNotMatch(ticker, />0</);
  assert.match(renderToStaticMarkup(React.createElement(StatTicker, { value: 1234.6, reduced: true, locale: 'en-US' })), />1,235</);
  assert.equal(renderToStaticMarkup(React.createElement(StatTicker, { value: undefined, reduced: true })), '—');
});

test('loading, failure, no data and unconfigured parts all retain an uncollapsed simulation badge and text status', () => {
  const loading = { ...fixture(), ...EMPTY_TELEMETRY, connectionState: 'offline' as const, series: [] };
  const failed = { ...loading, phase: 'error' as const, error: 'invalid_data' as const };
  const empty = fixture(); empty.series = empty.series.map(row => ({ ...row, points: [], windowPoints: [], chartPoints: [], latest: undefined })); empty.phase = 'empty';
  const unconfigured = { ...fixture(), series: [] };
  for (const data of [loading, failed, empty, unconfigured]) {
    const html = render(data); assert.match(html, /data-source="simulated"/); assert.match(html, /class="telemetry-badge"[^>]*>.*仿真数据/);
    assert.ok(html.indexOf('telemetry-badge') < (html.indexOf('<details') < 0 ? html.length : html.indexOf('<details')));
    assert.doesNotMatch(html, /实时|正常|异常/);
  }
  assert.match(render(loading), /正在连接仿真数据/); assert.match(render(failed), /数据校验失败/);
  assert.match(render(empty), /当前时间窗暂无数据/); assert.doesNotMatch(render(empty), /<figure/);
  assert.match(render(unconfigured), /此部件未配置仿真通道/);
  assert.match(render(failed, 'en'), /Simulated data.*Offline/); assert.match(render(failed, 'en'), /Data validation failed/);
});

test('a single buffered sample remains visible as a point and does not offer an unusable time slider', () => {
  const data = fixture(); data.series = data.series.map(row => ({ ...row, windowPoints: [row.latest!], chartPoints: [row.latest!] }));
  const html = render(data); assert.match(html, /class="telemetry-dot"/);
  assert.match(html, /type="range"[^>]*disabled=""/); assert.doesNotMatch(html, /NaN|Infinity/);
});

test('history failure/loading and delayed/offline retained samples have retry, icons/text and an accessible table alternative', () => {
  const data = fixture(); data.series[0].historyStatus = 'loading'; data.series[1].historyStatus = 'error';
  for (const state of ['delayed', 'offline'] as const) {
    data.connectionState = state; const html = render(data);
    assert.match(html, state === 'delayed' ? /延迟/ : /离线/); assert.match(html, /末次样本/);
    assert.match(html, /历史加载中/); assert.match(html, /历史读取失败/); assert.match(html, /重试历史/);
    assert.match(html, /<table>/); assert.match(html, /<caption>/); assert.match(html, /scope="row"/); assert.match(html, /type="range"/);
    assert.match(html, /aria-valuetext=/); assert.match(html, /aria-describedby=/); assert.match(html, /aria-pressed="true"/);
    assert.match(html, /仿真演示阈值,非厂家标准/); assert.match(html, /config\/telemetry-demo\.json/);
    assert.doesNotMatch(html, /实时/);
  }
});

test('CSV exports original window samples with scope, simulation watermark, threshold provenance and safe text cells', () => {
  const data = fixture(), csv = telemetryCsv(data.series, 'en');
  assert.ok(csv.startsWith('\uFEFF')); assert.equal(csv.trim().split('\r\n').length, 10);
  assert.equal(csv.split(TELEMETRY_WATERMARK).length - 1, 9); assert.equal(csv.split('"simulated"').length - 1, 9);
  assert.match(csv, /"t70-demo","t70\.battery-box\.temperature","battery_box"/);
  assert.match(csv, /"demo","仿真演示阈值,非厂家标准"/);
  for (const row of data.series) for (const point of row.windowPoints) assert.ok(csv.includes(`"${point.value}"`));
  const row = structuredClone(data.series[0]); row.channel.name.en = '=1+1,"quoted"'; row.windowPoints = [row.windowPoints[0]];
  assert.match(telemetryCsv([row], 'en'), /"'=1\+1,""quoted"""/);
  row.channel.name.en = '\t=2'; assert.ok(telemetryCsv([row], 'en').includes('"\'\t=2"'));
  assert.equal(telemetryCsv([], 'zh').trim().split('\r\n').length, 1, 'empty export must not invent a sample');
});
