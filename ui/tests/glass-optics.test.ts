import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGlassMaps, stepGlassSpring } from '../src/lib/glass-optics';

test('rounded glass preserves a neutral center and bends opposing edges in opposing directions', () => {
  const map = createGlassMaps(360, 60, 30);
  const at = (x: number, y: number) => (y * map.width + x) * 4;
  const center = at(180, 30), left = at(1, 30), right = at(358, 30);
  assert.deepEqual([...map.normal.slice(center, center + 4)], [128, 128, 128, 255]);
  assert.equal(map.rim[center + 3], 0);
  assert.ok(map.normal[left] < 40 && map.normal[right] > 215);
  assert.ok(map.rim[left + 3] > 200 && map.rim[right + 3] > 200);
  assert.equal(map.rim[at(0, 0) + 3], 0, 'the clipped capsule corner must not create a square lens');
  assert.ok(map.normal[at(180, 1) + 2] < 40);
  assert.ok(map.normal[at(180, 58) + 2] > 215);
});

test('large and tall glass maps respect the raster budget and retain shape and independent radii', () => {
  for (const [width, height] of [[2400, 70], [326, 1200], [320, 54]]) {
    const map = createGlassMaps(width, height, 24, 49_152);
    assert.ok(map.width * map.height <= 49_152);
    assert.ok(Math.abs(map.width / map.height - width / height) / (width / height) < .02);
    assert.equal(map.normal.length, map.width * map.height * 4);
  }
  const capsule = createGlassMaps(200, 80, 999);
  const clamped = createGlassMaps(200, 80, 40);
  assert.deepEqual(capsule.normal, clamped.normal);
  assert.notDeepEqual(createGlassMaps(200, 80, 8).rim, clamped.rim);
});

test('optical springs settle at different refresh rates and after long suspended-frame gaps', () => {
  for (const seconds of [1 / 120, 1 / 60, 1 / 30, 8]) {
    let position = 1, velocity = 0, settled = false;
    for (let frame = 0; frame < 240 && !settled; frame++) {
      const next = stepGlassSpring(position, velocity, 1.4, seconds);
      ({ position, velocity, settled } = next);
      assert.ok(Number.isFinite(position) && Number.isFinite(velocity));
      assert.ok(position >= .9 && position < 1.5, 'bounded pressure must not explode');
    }
    assert.equal(settled, true);
    assert.equal(position, 1.4);
    assert.equal(velocity, 0);
    for (let frame = 0; frame < 240; frame++) {
      ({ position, velocity } = stepGlassSpring(position, velocity, 1, seconds));
    }
    assert.equal(position, 1, 'release returns to the resting curvature');
  }
});
