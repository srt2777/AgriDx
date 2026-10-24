import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCHEMATIC_HUD,
  STUDIO_LIGHTS,
  STUDIO_LIGHT_LOOK,
  STUDIO_PRESENTATIONS,
  STUDIO_TURNTABLE_SPEED,
  partOpacity,
  schematicSpan,
} from '../src/components/studio-schematic';

test('模型工坊的灯光与透视预设可切换，测量读数标明结构示意', () => {
  assert.deepEqual(STUDIO_LIGHTS.map((item) => item.id), ['day', 'studio', 'night']);
  assert.deepEqual(STUDIO_PRESENTATIONS.map((item) => item.id), ['solid', 'isolate', 'xray']);
  assert.ok(STUDIO_TURNTABLE_SPEED < 0.8);
  assert.ok(STUDIO_LIGHT_LOOK.night.key < STUDIO_LIGHT_LOOK.day.key);
  assert.equal(STUDIO_LIGHT_LOOK.studio.background, '#101820');
  assert.match(SCHEMATIC_HUD.zh.title, /结构示意/);
  assert.match(SCHEMATIC_HUD.zh.note, /不是毫米/);
  assert.match(SCHEMATIC_HUD.en.title, /Structure illustration/);
  assert.match(SCHEMATIC_HUD.en.note, /not millimetres/i);
  const span = schematicSpan({ x: 2, y: 1, z: 4 });
  assert.deepEqual(span, { width: 50, height: 25, length: 100 });
  assert.equal(schematicSpan({ x: 0, y: 0, z: 0 }), null);
  assert.equal(partOpacity('solid', false, false, 1), 0.09);
  assert.equal(partOpacity('solid', true, true, 1), 1);
  assert.equal(partOpacity('isolate', false, false, 1), 0);
  assert.equal(partOpacity('isolate', true, false, 1), 1);
  assert.equal(partOpacity('isolate', false, true, 1), 1);
  assert.equal(partOpacity('xray', true, true, 1), 0.22);
  assert.equal(partOpacity('xray', true, false, 1), 1);
  assert.equal(partOpacity('xray', false, false, 1), 0.22);
});
