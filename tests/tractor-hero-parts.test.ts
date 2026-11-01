import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partChipLabel, partGroup } from '../src/pages/HomePage/sections/tractor-hero-parts';

test('engine, gearbox, hydraulics and PTO map to warehouse groups', () => {
  assert.equal(partGroup('engine'), 'engine');
  assert.equal(partGroup('gearbox'), 'drivetrain');
  assert.equal(partGroup('hydraulic_lift'), 'hydraulics');
  assert.equal(partGroup('three_point_hitch'), 'hydraulics');
  assert.equal(partGroup('pto'), 'drivetrain');
  assert.equal(partGroup('cab'), 'cab');
  assert.equal(partGroup('wheel_fl'), 'wheels');
});

test('wheel chips are disambiguated by side, other parts keep their catalog label', () => {
  assert.equal(partChipLabel('wheel_fl', '轮胎'), '轮胎 · 左前');
  assert.equal(partChipLabel('wheel_rr', '轮胎'), '轮胎 · 右后');
  assert.equal(partChipLabel('gearbox', '变速箱'), '变速箱');
});

test('unknown parts fall back to the whole-tractor group', () => {
  assert.equal(partGroup('unknown-part'), 'all');
});
