import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pistonPosition } from '../src/components/engine-demo/kinematics';
test('piston reaches dead centres and keeps a constant connecting rod length', () => {
  assert.ok(Math.abs(pistonPosition(0) - 1.44) < 1e-10);
  assert.ok(Math.abs(pistonPosition(Math.PI) - .8) < 1e-10);
  for (let i = 0; i <= 360; i++) {
    const angle = i * Math.PI / 180;
    const length = Math.hypot(.32 * Math.sin(angle), pistonPosition(angle) - .32 * Math.cos(angle));
    assert.ok(Math.abs(length - 1.12) < 1e-10);
    assert.ok(Math.abs(pistonPosition(angle) - pistonPosition(angle + 2 * Math.PI)) < 1e-10);
  }
});
