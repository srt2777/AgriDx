import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initialDriveState,
  isWalkable,
  nearbyZone,
  planRoute,
  stepDrive,
  stepRoute,
  WORLD_ZONES,
  type DriveAction,
  type DriveState,
} from '../src/pages/ExhibitionPage/world-navigation';

function drive(state: DriveState, actions: DriveAction[], frames: number, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) state = stepDrive(state, new Set(actions), dt);
  return state;
}

test('漫游支持前进、后退和转向，长时间帧不造成位置跳跃', () => {
  const start = initialDriveState();
  assert.ok(drive(start, ['forward'], 60).z < start.z - 2);
  assert.ok(drive(start, ['backward'], 60).z > start.z + 1);
  const turning = drive(start, ['forward', 'left'], 50);
  assert.ok(turning.x < -0.7);
  assert.ok(
    Math.hypot(
      stepDrive(start, new Set(['forward']), 20).x - start.x,
      stepDrive(start, new Set(['forward']), 20).z - start.z,
    ) < 0.2,
  );
});

test('刹车和释放方向能停下，60Hz与144Hz移动距离一致', () => {
  const sixty = drive(initialDriveState(), ['forward'], 60);
  const highRefresh = drive(initialDriveState(), ['forward'], 144, 1 / 144);
  assert.ok(Math.abs(sixty.z - highRefresh.z) < 0.05);
  const released = drive(sixty, [], 120);
  assert.equal(released.speed, 0);
  const braked = drive(sixty, ['brake', 'forward'], 60);
  assert.equal(braked.speed, 0);
  assert.ok(Math.abs(braked.z - sixty.z) < Math.abs(released.z - sixty.z));
});

test('持续按键不会驶出园区，或穿过四个展区建筑', () => {
  const boundary = drive(initialDriveState(), ['forward'], 1500);
  assert.ok(isWalkable(boundary.x, boundary.z));
  assert.ok(boundary.z >= -10);
  for (const zone of WORLD_ZONES) {
    const x = zone.x + 3.3,
      z = zone.z;
    let state: DriveState = { x, z, heading: 0, speed: 0 };
    for (let i = 0; i < 500; i++) {
      state = stepDrive(state, new Set(['forward']), 1 / 60);
      assert.ok(isWalkable(state.x, state.z));
      assert.ok(state.x >= zone.x + 3.1 - 0.001);
    }
  }
});

test('四个展区及园区外沿可自动到达任一展区，沿途不穿过建筑', () => {
  const starts: DriveState[] = [
    initialDriveState(),
    ...WORLD_ZONES.map((zone) => ({ x: zone.arrival[0], z: zone.arrival[1], heading: 0, speed: 0 })),
    { x: 12, z: 6, heading: 0, speed: 0 },
    { x: -12, z: -6, heading: 0, speed: 0 },
  ];
  for (const start of starts)
    for (const zone of WORLD_ZONES) {
      let state = { ...start };
      const route = planRoute(state, zone.id);
      let frame = 0;
      while (route.length && frame++ < 2400) {
        const result = stepRoute(state, route[0], 1 / 60);
        state = result.state;
        assert.ok(isWalkable(state.x, state.z), `blocked route to ${zone.id}`);
        if (result.arrived) route.shift();
      }
      assert.equal(route.length, 0, `did not arrive from ${start.x},${start.z} to ${zone.id}`);
      assert.ok(Math.hypot(state.x - zone.arrival[0], state.z - zone.arrival[1]) < 0.1);
      assert.equal(nearbyZone(state.x, state.z), zone.id);
    }
});
