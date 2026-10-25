import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TelemetryAlerts } from '../src/components/parts-tractor/TelemetryAlerts';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog } from '../server/telemetry/simulator';
import { EMPTY_TELEMETRY } from '../src/features/telemetry/store';

const config = loadTelemetryDemoConfig(), catalog = telemetryCatalog(config), epochMs = Date.UTC(2026, 9, 25);
type Data = React.ComponentProps<typeof TelemetryAlerts>['data'];
function fixture(): Data {
  const frame = simulateTelemetry(config, { epochMs, elapsedMs: 80000, scenario: 'coolant-rise', loop: false });
  return { catalog, phase: 'ready', connectionState: 'simulated', alerts: frame.alerts, retry: () => {} };
}
const render = (data: Data, lang: 'zh' | 'en' = 'zh') => renderToStaticMarkup(React.createElement(TelemetryAlerts, { data, lang }));

test('alert cards show only received simulation alerts with configured threshold provenance, scope, value and original sample time', () => {
  const data = fixture(); assert.ok(data.alerts.length > 0);
  for (const lang of ['zh', 'en'] as const) {
    const html = render(data, lang); assert.match(html, lang === 'zh' ? /仿真告警 · 服务范围/ : /Simulated alerts · Service scope/);
    assert.equal((html.match(/<li /g) ?? []).length, data.alerts.length);
    for (const alert of data.alerts) {
      const channel = catalog.channels.find(item => item.id === alert.channelId)!, device = catalog.devices.find(item => item.id === alert.deviceId)!;
      assert.ok(html.includes(device.name[lang])); assert.ok(html.includes(channel.name[lang]));
      assert.ok(html.includes(new Date(alert.at).toISOString())); assert.ok(html.includes(channel.unit));
      assert.ok(html.includes(alert.value.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { minimumFractionDigits: channel.precision, maximumFractionDigits: channel.precision })));
    }
    assert.match(html, /demo/); assert.match(html, /aria-live="off"/);
    for (const alert of data.alerts) assert.ok(html.includes(`data-severity="${alert.severity}"`));
    assert.doesNotMatch(html, /实时|设备正常|确定故障|已核实故障/);
  }
  assert.match(render(data), /仿真演示阈值,非厂家标准/); assert.match(render(data, 'en'), /not manufacturer standards/);
});

test('loading, failure and no samples are distinct text states and rendering never initiates a retry', () => {
  let calls = 0;
  const data: Data = { ...EMPTY_TELEMETRY, connectionState: 'offline', retry: () => { calls++; } };
  assert.match(render(data), /正在读取仿真告警/); assert.doesNotMatch(render(data), /重新读取告警/);
  const error = render({ ...data, phase: 'error' }); assert.match(error, /读取失败/); assert.match(error, /重新读取告警/); assert.match(error, /role="alert"/);
  assert.doesNotMatch(error, /正在读取仿真告警|未触发/);
  assert.match(render({ ...data, catalog, phase: 'empty' }), /暂无可确认的当前仿真告警样本/);
  assert.equal(calls, 0);
});

test('an empty alert set cannot establish a condition or evaluate channels without configured thresholds', () => {
  const html = render({ ...fixture(), alerts: [] });
  assert.match(html, /未触发已配置的演示阈值/); assert.match(html, /无阈值通道不参与判定/); assert.match(html, /未对实车状态作出结论/);
  assert.doesNotMatch(html, /正常|异常|<li /);
  assert.match(render({ ...fixture(), alerts: [] }, 'en'), /Channels without thresholds are not evaluated/);
});

test('offline and delayed alerts explicitly retain the last received sample instead of claiming a current alarm or a normal empty state', () => {
  for (const connectionState of ['offline', 'delayed'] as const) {
    const data = { ...fixture(), connectionState }, html = render(data);
    assert.match(html, /末次收到样本/); assert.match(html, /不代表当前时刻/); assert.match(html, /<li /);
    assert.match(render(data, 'en'), /last received sample/);
    const empty = render({ ...data, alerts: [] }); assert.match(empty, /暂无可确认/); assert.doesNotMatch(empty, /未触发|正常/);
  }
});

test('unknown, foreign, unconfigured or mismatched alert scope fails closed rather than showing an unsupported conclusion', () => {
  const data = fixture(), first = data.alerts[0];
  const unconfigured = catalog.channels.find(channel => !channel.threshold)!;
  const candidates = [{ ...first, channelId: 'unknown' }, { ...first, source: 'device' as never }, { ...first, deviceId: 'foreign' },
    { ...first, partId: 'unknown' }, { ...first, channelId: unconfigured.id, deviceId: unconfigured.deviceId, partId: unconfigured.partId }];
  for (const alert of candidates) {
    const html = render({ ...data, alerts: [alert] }); assert.match(html, /告警与通道配置不一致/); assert.doesNotMatch(html, /<li |未触发|正常|异常/);
  }
});

test('attention and alarm use icons and explicit labels without turning them into unmarked vehicle alarms', () => {
  const data = fixture();
  for (const severity of ['attention', 'alarm'] as const) {
    const html = render({ ...data, alerts: [{ ...data.alerts[0], severity }] });
    assert.match(html, severity === 'attention' ? /仿真告警.*演示关注/ : /仿真告警.*演示告警/);
    assert.ok(html.includes(`data-severity="${severity}"`));
    assert.match(html, /<svg[^>]*aria-hidden="true"/); assert.match(html, /<strong>仿真告警/);
    assert.doesNotMatch(html, /role="alert"/); // Sample updates should not repeatedly interrupt a screen reader.
  }
});
