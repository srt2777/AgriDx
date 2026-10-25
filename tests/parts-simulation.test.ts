import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeshStandardMaterial } from 'three';
import { applySimulationHighlight, drawStructureWatermark, focusSimulationDetails, simulationTargetForAlert } from '../src/components/parts-tractor/parts-simulation';
import { resolveSelection } from '../src/components/parts-tractor/parts-catalog';
import { partVisual } from '../src/components/parts-tractor/parts-motion';
import { TelemetryAlerts } from '../src/components/parts-tractor/TelemetryAlerts';
import { loadTelemetryDemoConfig, simulateTelemetry, telemetryCatalog } from '../server/telemetry/simulator';
import { TELEMETRY_WATERMARK, type TelemetryAlert } from '../shared/telemetry';

const config = loadTelemetryDemoConfig(), catalog = telemetryCatalog(config);
const frame = simulateTelemetry(config, { epochMs: Date.UTC(2026, 9, 25), elapsedMs: 80000, scenario: 'battery-spread' });
const alert = frame.alerts[0];

test('simulated alert targets use both catalogue scope and actual parts.json selections across both models', () => {
  assert.ok(alert);
  for (const channel of catalog.channels) {
    if (!channel.threshold) continue;
    const point = frame.points.find(item => item.channelId === channel.id)!;
    const entry: TelemetryAlert = { id: channel.id, source: 'simulated', channelId: channel.id, deviceId: channel.deviceId, partId: channel.partId,
      at: point.at, value: point.value, severity: 'attention', label: { zh: '仿真告警', en: 'Simulated alert' }, threshold: channel.threshold };
    const target = simulationTargetForAlert(entry, catalog); assert.ok(target, channel.id);
    const device = catalog.devices.find(item => item.id === channel.deviceId)!;
    assert.equal(target.modelId, device.modelId); assert.equal(target.source, 'simulated'); assert.equal(target.at, point.at);
    assert.equal(resolveSelection(target.selection, target.modelId)?.node.partId, channel.partId);
    assert.deepEqual(Object.keys(target).sort(), ['at', 'channelId', 'modelId', 'partId', 'selection', 'source'], 'no reading or numeric threshold enters the selection or knowledge scope');
  }
});

test('unknown or foreign mappings, missing thresholds, unsupported sources and invalid sample times cannot select a part', () => {
  assert.equal(simulationTargetForAlert(alert, null), null);
  for (const bad of [{ ...alert, source: 'device' as never }, { ...alert, deviceId: 'foreign' }, { ...alert, channelId: 'unknown' }, { ...alert, partId: 'unknown' },
    ...[NaN, Infinity, -1, Number.MAX_SAFE_INTEGER].map(at => ({ ...alert, at }))]) assert.equal(simulationTargetForAlert(bad, catalog), null);
  const copy = structuredClone(catalog), definition = copy.channels.find(channel => channel.id === alert.channelId)!;
  definition.threshold = null; assert.equal(simulationTargetForAlert(alert, copy), null);
  definition.threshold = alert.threshold; definition.partId = 'unknown';
  assert.equal(simulationTargetForAlert({ ...alert, partId: 'unknown' }, copy), null);
  const device = copy.devices.find(item => item.id === alert.deviceId)!; device.modelId = 'unknown' as never;
  assert.equal(simulationTargetForAlert(alert, copy), null);
});

test('static simulation emission does not enable mobile outlines, change geometry opacity or turn into a legacy pulse', () => {
  const material = new MeshStandardMaterial({ color: '#123456', opacity: .7, transparent: true });
  const originalColor = material.color.clone();
  applySimulationHighlight(material);
  assert.equal(material.emissive.getHexString(), 'ffca68'); assert.equal(material.emissiveIntensity, .5);
  assert.ok(material.color.equals(originalColor)); assert.equal(material.opacity, .7); assert.equal(material.transparent, true);
  const visual = partVisual({ partId: 'battery_box', selected: true, hovered: false, hasSelection: true, presentation: 'xray', faultPartId: null, outlineEnabled: false });
  assert.equal(visual.outline, false); assert.equal(visual.pulse, false); assert.equal(visual.opacity, 1);
  material.dispose();
});

test('structure exports always carry a CAD limitation and simulation exports also carry the fixed bilingual watermark', () => {
  for (const simulated of [false, true]) {
    const texts: Array<{ text: string; x: number; y: number; width: number }> = [], bands: number[][] = []; let saves = 0, restores = 0;
    const context = { save: () => saves++, restore: () => restores++, fillRect: (...args: number[]) => bands.push(args),
      fillText: (text: string, x: number, y: number, width: number) => texts.push({ text, x, y, width }) } as unknown as CanvasRenderingContext2D;
    drawStructureWatermark(context, 375, 600, simulated);
    assert.equal(saves, 1); assert.equal(restores, 1); assert.equal(bands.length, 1);
    assert.equal(texts[0].text, '结构示意，不代表实车 CAD'); assert.match(texts[1].text, /Structural schematic/);
    assert.equal(texts.some(item => item.text === TELEMETRY_WATERMARK), simulated);
    assert.ok(texts.every(item => item.x >= 0 && item.y > 0 && item.y <= 600 && item.width > 0 && item.width <= 375));
    assert.equal(texts.length, simulated ? 3 : 2);
  }
});

test('structural selection resets stale drawer scroll before focus and respects reduced motion while revealing sources', () => {
  for (const reduced of [false, true]) {
    const calls: unknown[] = [];
    const drawer = { scrollTop: 200, focus: (options?: FocusOptions) => { assert.equal(drawer.scrollTop, 0); calls.push(options); },
      scrollIntoView: (options?: boolean | ScrollIntoViewOptions) => calls.push(options) };
    focusSimulationDetails(drawer, reduced);
    assert.deepEqual(calls, [{ preventScroll: true }, { behavior: reduced ? 'instant' : 'smooth', block: 'nearest' }]);
  }
  assert.doesNotThrow(() => focusSimulationDetails(null, true));
});

test('alert browsing is opt-in for reusable panels and only resolved structures gain keyboard-operable part links', () => {
  const data = { catalog, alerts: [alert], phase: 'ready' as const, connectionState: 'simulated' as const, retry: () => {} };
  const render = (withSelection: boolean, lang: 'zh' | 'en' = 'zh', input = data) => renderToStaticMarkup(React.createElement(TelemetryAlerts,
    { data: input, lang, onSelect: withSelection ? () => {} : undefined }));
  assert.doesNotMatch(render(false), /查看部件与资料/);
  assert.match(render(true), /<button type="button" aria-label="查看部件与资料 · T70结构示意（仿真） · 电池压差">查看部件与资料<\/button>/); assert.match(render(true, 'en'), /View part and sources/);
  const copy = structuredClone(catalog); copy.channels.find(item => item.id === alert.channelId)!.partId = 'unknown';
  const missing = render(true, 'zh', { ...data, catalog: copy, alerts: [{ ...alert, partId: 'unknown' }] });
  assert.match(missing, /结构定位待核实/); assert.doesNotMatch(missing, /查看部件与资料/);
});
