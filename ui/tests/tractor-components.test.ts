import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { getComponentBounds, getComponentMeshes, getComponentOwner, isTractorComponent } from '../src/components/tractor-component-utils';

test('component picking accepts mesh and ancestor metadata, and ignores unknown tags', () => {
  const group = new THREE.Group();
  group.userData.component = 'engine';
  const nested = new THREE.Group();
  nested.userData.component = 'unverified-import-name';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  group.add(nested);
  nested.add(mesh);
  assert.equal(getComponentOwner(mesh), group);
  mesh.userData.component = 'electrical';
  assert.equal(getComponentOwner(mesh), mesh);
  assert.equal(isTractorComponent('all'), false);
  assert.equal(isTractorComponent('unverified-import-name'), false);
  assert.equal(getComponentOwner(new THREE.Group()), null);
  mesh.geometry.dispose();
});

test('component bounds follow ancestor scale, rotation and exploded movement without including other groups', () => {
  const model = new THREE.Group();
  model.position.set(10, 2, -5);
  model.scale.setScalar(2);
  model.rotation.y = Math.PI / 2;
  const engine = new THREE.Group();
  engine.userData.component = 'engine';
  engine.position.x = 1;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 4));
  mesh.position.x = 2;
  engine.add(mesh);
  const wheel = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  wheel.userData.component = 'wheels';
  wheel.position.x = -20;
  model.add(engine, wheel);

  assert.deepEqual(getComponentMeshes(model, 'engine'), [mesh]);
  assert.equal(getComponentMeshes(model, 'all').length, 2);
  const assembled = getComponentBounds(model, 'engine');
  assert.ok(assembled.getCenter(new THREE.Vector3()).distanceTo(new THREE.Vector3(10, 2, -11)) < 1e-9);
  assert.ok(assembled.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3(8, 4, 4)) < 1e-9);
  engine.position.y += .75;
  const exploded = getComponentBounds(model, 'engine');
  assert.ok(Math.abs(exploded.min.y - assembled.min.y - 1.5) < 1e-9);
  assert.ok(getComponentBounds(model, 'all').max.z > exploded.max.z + 20);
  assert.equal(getComponentBounds(model, 'cab').isEmpty(), true);
  mesh.geometry.dispose();
  wheel.geometry.dispose();
});
