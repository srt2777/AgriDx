import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXHIBITS,
  HALL_IDLE_INTERVAL_MS,
  MACHINE_PARTS,
  STATUS_HALO,
  exhibitStatus,
  floorAoUv,
  idleMotionAllowed,
} from '../src/features/campus-equipment/hall-machines';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('展厅光环颜色和状态表一致，机具零件写在模型里', () => {
  const models = readFileSync(path.join(root, 'src/features/campus-equipment/hall-exhibits.tsx'), 'utf8');
  assert.equal(new Set(Object.values(STATUS_HALO)).size, 4);
  assert.match(models, /name="cab"/);
  assert.match(models, /name="wheel"/);
  assert.match(models, /name="exhaust"/);
  assert.match(models, /name="hopper"/);
  assert.match(models, /name="header"/);
  assert.match(models, /name="sensor"/);
  assert.match(models, /'reel'/);
  assert.match(models, /'rotor'/);
  assert.match(models, /name="beacon"/);
  for (const exhibit of EXHIBITS) {
    for (const part of MACHINE_PARTS[exhibit.kind]) {
      assert.equal(models.includes(part), true);
    }
    const { u, v } = floorAoUv(exhibit.position[0], exhibit.position[2]);
    assert.ok(u > 0 && u < 1 && v > 0 && v < 1);
  }
  assert.equal(exhibitStatus('a1'), 'online');
  assert.equal(exhibitStatus('d1'), 'offline');
  assert.equal(exhibitStatus('c1'), 'maintenance');
  assert.equal(exhibitStatus('d3'), 'standby');
});

test('机具动态可关，隐藏标签页和减少动态时不转', () => {
  assert.equal(idleMotionAllowed({ enabled: true, reduced: false, hidden: false }), true);
  assert.equal(idleMotionAllowed({ enabled: false, reduced: false, hidden: false }), false);
  assert.equal(idleMotionAllowed({ enabled: true, reduced: true, hidden: false }), false);
  assert.equal(idleMotionAllowed({ enabled: true, reduced: false, hidden: true }), false);
  assert.ok(HALL_IDLE_INTERVAL_MS >= 80);
  assert.ok(HALL_IDLE_INTERVAL_MS <= 200);
});
