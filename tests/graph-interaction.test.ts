import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphCamera, zoomGraph, fitGraph, stepGraphCamera, cameraMoving, graphNeighborhood, relationCoordinates } from '../src/pages/KnowledgePage/graph-interaction';
import { taxonomyNodes } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
import { loadKnowledgeCatalog } from '../server/knowledge/catalog';

test('zoom buttons and pinch share clamped targets, anchoring and smooth convergence', () => {
  const camera = createGraphCamera();
  zoomGraph(camera, 1.4, { x: 120, y: 60 });
  assert.equal(camera.targetZoom, 1.4);
  assert.ok(camera.targetPanX < 0 && camera.targetPanY < 0);
  assert.equal(camera.zoom, 1);
  stepGraphCamera(camera, 1 / 30);
  assert.ok(camera.zoom > 1 && camera.zoom < 1.4);
  for (let i = 0; i < 100; i++) stepGraphCamera(camera, 1 / 30);
  assert.ok(Math.abs(camera.zoom - 1.4) < .001);
  assert.equal(cameraMoving(camera), false);
  zoomGraph(camera, 100); assert.equal(camera.targetZoom, 12);
  zoomGraph(camera, .00001); assert.equal(camera.targetZoom, .4);
  fitGraph(camera); stepGraphCamera(camera, 0, true);
  assert.equal(camera.zoom, 1); assert.equal(camera.panX, 0); assert.equal(camera.panY, 0);
});

test('rotation inertia decays and fit resets all camera targets', () => {
  const camera = createGraphCamera(); camera.velocityYaw = .5; camera.velocityPitch = -.3;
  stepGraphCamera(camera, .03);
  assert.ok(camera.velocityYaw > 0 && camera.velocityYaw < .5);
  assert.ok(camera.yaw !== -.13);
  fitGraph(camera);
  assert.equal(camera.velocityYaw, 0); assert.equal(camera.velocityPitch, 0);
  for (let i = 0; i < 100; i++) stepGraphCamera(camera, 1 / 30);
  assert.equal(cameraMoving(camera), false);
  camera.velocityYaw = 2; camera.velocityPitch = -1;
  const target = camera.targetYaw;
  stepGraphCamera(camera, .03, true);
  assert.equal(camera.velocityYaw, 0); assert.equal(camera.targetYaw, target);
});

const nodes = taxonomyNodes(loadKnowledgeCatalog());
test('relation focus contains only actual ancestors and direct children in catalog order', () => {
  const model = nodes.find(node => node.level === 'model')!;
  const original = structuredClone(nodes);
  const group = graphNeighborhood(nodes, model.id, 5);
  assert.equal(group.selected?.id, model.id);
  assert.equal(group.ancestors.at(-1)?.id, model.parent);
  assert.deepEqual(group.children, nodes.filter(node => node.parent === model.id));
  assert.equal(group.visibleChildren.length, Math.min(5, group.children.length));
  assert.ok(group.shown.every(node => group.ancestors.includes(node) || node === model || node.parent === model.id));
  const part = nodes.find(node => node.level === 'part')!;
  const leaf = graphNeighborhood(nodes, part.id);
  assert.deepEqual(leaf.ancestors.map(node => node.level), ['brand', 'model', 'component']);
  assert.equal(leaf.children.length, 0);
  assert.deepEqual(graphNeighborhood(nodes, 'unknown').shown, []);
  assert.deepEqual(nodes, original);
});

test('focused labels have separated mobile and desktop positions with complete parent paths', () => {
  const model = nodes.find(node => node.level === 'model')!;
  const group = graphNeighborhood(nodes, model.id, 10);
  for (const [width, height] of [[348, 560], [900, 620]]) {
    const coordinates = relationCoordinates(group.ancestors, model, group.visibleChildren, width, height);
    assert.equal(coordinates.size, group.shown.length);
    const values = [...coordinates.values()];
    for (const point of values) assert.ok(point.x > 0 && point.x < width && point.y > 0 && point.y < height);
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) assert.ok(Math.hypot(values[i].x - values[j].x, values[i].y - values[j].y) > 30);
  }
});
