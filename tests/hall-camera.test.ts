import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hallCameraGoal, HALL_OVERVIEW } from '../src/pages/HallPage/hall-camera';

test('展厅默认停在总览，点选展区后才飞近', () => {
  const home = hallCameraGoal(null, 1920);
  assert.deepEqual(home.position, [...HALL_OVERVIEW.position]);
  assert.deepEqual(home.look, [...HALL_OVERVIEW.look]);
  const close = hallCameraGoal('A', 1920);
  assert.ok(close.position[1] < home.position[1]);
  assert.equal(close.look[0] < 0, true);
  const wide = hallCameraGoal('B', 390);
  assert.ok(wide.position[1] > close.position[1]);
  assert.equal(wide.look[0] > 0, true);
});
