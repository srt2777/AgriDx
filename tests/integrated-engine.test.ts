import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitEngineToPart } from '../src/components/parts-tractor/engine-fit';

test('engine fit stays inside its host and is independent of tractor position and quantization scale', () => {
  const tractor = new THREE.Group(), engine = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, .9, .7));
  engine.add(mesh); tractor.add(engine);
  const fit = fitEngineToPart(engine);
  assert.ok(fit.scale * 4.8 <= 1.2 && fit.scale * 2.6 <= .9 && fit.scale * 1.3 <= .7);
  tractor.position.set(3, 4, -2); tractor.rotation.y = .7;
  engine.position.set(1.1, 1.6, 0); engine.scale.setScalar(.537);
  const moved = fitEngineToPart(engine);
  assert.ok(Math.abs(moved.scale - fit.scale) < 1e-10);
  moved.position.forEach((v, i) => assert.ok(Math.abs(v - fit.position[i]) < 1e-10));
  const attached = new THREE.Group(); engine.add(attached);
  const before = attached.getWorldPosition(new THREE.Vector3());
  engine.position.y += .55;
  const after = attached.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(after.y - before.y - .55) < 1e-10);
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
});
