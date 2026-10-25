import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TelemetryScenarioControls } from '../src/components/parts-tractor/TelemetryScenarioControls';
import { loadTelemetryDemoConfig, telemetryCatalog } from '../server/telemetry/simulator';
import { TELEMETRY_WATERMARK } from '../shared/telemetry';

type Data = React.ComponentProps<typeof TelemetryScenarioControls>['data'];
const catalog = telemetryCatalog(loadTelemetryDemoConfig());
function fixture(): Data {
  return { catalog, runId: 'run-a', connectionState: 'simulated', scenario: { id: 'battery-spread', revision: 2, startedAt: 1000, elapsedMs: 3500, loop: false },
    scenarioControl: { phase: 'idle', error: null, conflict: null }, changeScenario: async () => {}, retry: () => {} };
}
function render(data = fixture(), lang: 'zh' | 'en' = 'zh') {
  return renderToStaticMarkup(React.createElement(TelemetryScenarioControls, { data, lang }));
}

test('controls wait for sampled catalogue, run and complete control metadata instead of presenting an invented selection', () => {
  const data = fixture();
  for (const incomplete of [{ ...data, catalog: null }, { ...data, runId: null }, { ...data, scenario: null },
    { ...data, scenario: { ...data.scenario!, revision: undefined } }, { ...data, scenario: { ...data.scenario!, startedAt: undefined } }]) {
    const html = render(incomplete); assert.match(html, /等待带控制信息的仿真样本/); assert.doesNotMatch(html, /<select|<form|<progress/);
  }
  assert.match(render({ ...data, scenario: null }, 'en'), /Waiting for a simulation sample with control metadata/);
});

test('scenario choices come from the catalogue, disclose shared scope and use sampled progress rather than a UI clock', () => {
  const data = fixture(), html = render(data), en = render(data, 'en');
  for (const scenario of catalog.scenarios) {
    assert.ok(html.includes(scenario.name.zh)); assert.ok(en.includes(scenario.name.en));
    assert.ok(html.includes(`value="${scenario.id}"`));
  }
  assert.equal((html.match(/<option /g) ?? []).length, catalog.scenarios.length);
  assert.match(html, /value="battery-spread" selected=""/); assert.match(html, /已收到的场景/);
  assert.match(html, /3 \/ 120 秒/); assert.match(html, /<progress[^>]*max="120000"[^>]*value="3500"/);
  assert.match(html, /所有监测窗口.*清空旧场景曲线/); assert.match(html, /不表示实车状态/);
  assert.match(en, /every monitoring window.*clears previous scenario curves/); assert.match(en, /Manual actions only/);
  assert.match(html, /<label for="[^"]+-scenario">演示场景<\/label>/); assert.match(html, /aria-describedby=/);
  assert.doesNotMatch(html, /实时|正常运行中|设备正常|设备异常|已切换成功/);
});

test('pending, delayed and offline controls cannot submit a write while retaining received scope and progress', () => {
  const data = fixture();
  for (const connectionState of ['delayed', 'offline'] as const) {
    const html = render({ ...data, connectionState }); assert.match(html, /<fieldset disabled=""/);
    assert.match(html, /末次收到的场景/); assert.match(html, /重新读取场景/); assert.match(html, /<progress/);
  }
  const pending = render({ ...data, scenarioControl: { phase: 'pending', error: null, conflict: null } });
  assert.match(pending, /<fieldset disabled=""/); assert.match(pending, /正在请求切换/); assert.match(pending, /以随后收到的仿真样本为准/);
  assert.doesNotMatch(pending, /重新读取场景/);
});

test('a conflict ahead of the stream blocks writes; caught-up or later samples require a new manual choice', () => {
  const data = fixture();
  const conflict = { schemaVersion: 1 as const, source: 'simulated' as const, watermark: TELEMETRY_WATERMARK, scope: 'shared-service' as const,
    runId: 'run-b', revision: 3, id: 'position-drift' as const, loop: false, startedAt: 10000, elapsedMs: 0 };
  data.scenarioControl = { phase: 'conflict', error: null, conflict };
  const ahead = render(data); assert.match(ahead, /<fieldset disabled=""/); assert.match(ahead, /正在等待对应样本/); assert.match(ahead, /不会自动覆盖/);
  assert.match(ahead, /电池压差扩大/); // HTTP conflict metadata must not replace the sampled scenario.
  const caught = render({ ...data, runId: 'run-b', scenario: { ...data.scenario!, id: conflict.id, revision: 3 } });
  assert.doesNotMatch(caught, /<fieldset disabled/); assert.match(caught, /请核对上方已收到的场景/); assert.match(caught, /不会自动重试/);
  const later = render({ ...data, runId: 'run-c', scenario: { ...data.scenario!, revision: 4 } });
  assert.doesNotMatch(later, /<fieldset disabled/);
  const wrongRun = render({ ...data, scenario: { ...data.scenario!, revision: 3 } }); assert.match(wrongRun, /<fieldset disabled/);
});

test('control errors remain unconfirmed and offer an explicit read without initiating a write or automatic retry', () => {
  const data = fixture(); let writes = 0, reads = 0;
  data.changeScenario = async () => { writes++; }; data.retry = () => { reads++; };
  for (const error of ['unavailable', 'invalid_data', 'rate_limited'] as const) {
    const failed = { ...data, scenarioControl: { phase: 'error' as const, error, conflict: null } };
    const zh = render(failed), en = render(failed, 'en');
    assert.match(zh, /role="alert"/); assert.match(zh, /未确认|未获确认/); assert.match(zh, /重新读取场景/); assert.match(en, /unconfirmed/);
    assert.doesNotMatch(zh, /切换失败，未应用|切换成功/);
  }
  assert.equal(writes, 0); assert.equal(reads, 0);
});

test('loop and completed script states describe simulation scripts and keep the normal-reset action separate from selected values', () => {
  const data = fixture(), duration = catalog.scenarios.find(item => item.id === data.scenario!.id)!.durationMs;
  const looping = render({ ...data, scenario: { ...data.scenario!, loop: true } });
  assert.match(looping, /type="checkbox" checked=""/); assert.match(looping, /循环播放场景脚本/); assert.match(looping, /回到正常场景/);
  const ended = render({ ...data, scenario: { ...data.scenario!, elapsedMs: duration } });
  assert.match(ended, /本轮脚本已结束/); assert.match(ended, /120 \/ 120 秒/);
  assert.doesNotMatch(looping, /本轮脚本已结束/);
});

test('scenario controls reuse the panel’s motion-free styles and accessible touch targets', () => {
  const css = readFileSync(new URL('../src/components/parts-tractor/parts-studio.css', import.meta.url), 'utf8');
  assert.match(css, /\.telemetry-panel, \.telemetry-panel \* \{ animation: none; transition: none; \}/);
  assert.match(css, /\.telemetry-scenarios select[^}]*min-height: 44px/);
  assert.match(css, /\.telemetry-loop[^}]*min-height: 44px/);
  assert.match(css, /\.telemetry-panel button, \.telemetry-table summary[^}]*min-height: 44px/);
  assert.match(css, /:is\(button, input, select, summary\):focus-visible/);
});
