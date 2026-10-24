import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { studioQuality, studioShadowVolume } from '../src/components/parts-tractor/studio-rendering';

test('shadow frustum scales with the actual machine and covers exploded endpoints', () => {
  for (const scale of [.1, 1, 10]) {
    const box = new THREE.Box3(new THREE.Vector3(-2, 0, -1).multiplyScalar(scale), new THREE.Vector3(2, 3, 1).multiplyScalar(scale));
    const offset = new THREE.Vector3(0, 2, 1).multiplyScalar(scale);
    const volume = studioShadowVolume(box, [offset]);
    const corner = box.max.clone().add(offset);
    assert.ok(corner.distanceTo(volume.center) < volume.radius);
    assert.ok(volume.extent > volume.radius);
    assert.ok(volume.near > 0 && volume.far > volume.radius * 5);
    assert.ok(Math.abs(volume.normalBias / volume.radius - .0015) < 1e-10);
  }
});
test('mobile quality lowers pixel and shadow cost while retaining texture filtering', () => {
  const mobile = studioQuality(true), desktop = studioQuality(false);
  assert.ok(mobile.dpr[1] < desktop.dpr[1]);
  assert.ok(mobile.shadowSize < desktop.shadowSize);
  assert.ok(mobile.anisotropy >= 1 && mobile.anisotropy < desktop.anisotropy);
});

test('unmounted canvases stop forwarding context-loss events to the next machine', async () => {
  const { bindContextLoss } = await import('../src/lib/webgl');
  const canvas = new EventTarget(); let losses = 0;
  const unbind = bindContextLoss(canvas as unknown as HTMLCanvasElement, () => losses++);
  const activeLoss = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(activeLoss);
  assert.equal(losses, 1); assert.equal(activeLoss.defaultPrevented, true);
  unbind(); canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert.equal(losses, 1);
});
