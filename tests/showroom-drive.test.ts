import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilotInput, clampWalk, planGuideRoute, resolveCollision, stepVehicle, turnRadius, type Pose } from '../src/pages/ShowroomPage/showroom-drive';

const start: Pose = { x: 0, z: 0, heading: 0, speed: 0, steer: 0 };

test('stepVehicle accelerates gradually (heavy feel) and caps at max speed', () => {
  let pose = start;
  for (let i = 0; i < 10; i++) pose = stepVehicle(pose, { throttle: 1, steer: 0, brake: false }, 0.1);
  assert.ok(pose.speed > 0 && pose.speed < 3.2, `speed ${pose.speed}`);
  for (let i = 0; i < 60; i++) pose = stepVehicle(pose, { throttle: 1, steer: 0, brake: false }, 0.1);
  assert.equal(pose.speed, 3.2);
});

test('brake stops the tractor and reverse is slower than forward', () => {
  let pose = { ...start, speed: 3 };
  for (let i = 0; i < 20; i++) pose = stepVehicle(pose, { throttle: 0, steer: 0, brake: true }, 0.1);
  assert.equal(pose.speed, 0);
  let rev = start;
  for (let i = 0; i < 60; i++) rev = stepVehicle(rev, { throttle: -1, steer: 0, brake: false }, 0.1);
  assert.equal(rev.speed, -1.2);
});

test('turn radius is wide at full steer (field-safe turning)', () => {
  const radius = turnRadius(2, 0.5);
  assert.ok(radius > 2 && radius < 10, `radius ${radius}`);
  assert.equal(turnRadius(2, 0), Number.POSITIVE_INFINITY);
});

test('resolveCollision never lets the tractor enter the T70 platform', () => {
  const prev: Pose = { ...start, x: 6, z: 0 };
  const next: Pose = { ...start, x: 0, z: 0, speed: 2 };
  const resolved = resolveCollision(next, prev);
  assert.ok(Math.abs(resolved.x) >= 3.4 + 1.9 - 0.01 || resolved.speed === 0, `x ${resolved.x}`);
});

test('clampWalk keeps the walker inside the field and out of booths', () => {
  const out = clampWalk(100, -100);
  assert.ok(Math.abs(out.x) <= 30 && Math.abs(out.z) <= 22);
  const booth = clampWalk(16.5, -10);
  assert.ok(Math.abs(booth.x - 16.5) > 0.4 || Math.abs(booth.z - -10) > 0.4, `booth ${booth.x},${booth.z}`);
});

test('planGuideRoute runs along the main aisle and ends at the dock', () => {
  const route = planGuideRoute({ x: -10, z: 4 }, 'diagnosis');
  assert.deepEqual(route[route.length - 1], [16.5, -5.2]);
  assert.ok(route.every(([, z]) => z === 0 || z === -5.2));
});

test('autopilotInput steers toward the waypoint and reports arrival', () => {
  const { input, arrived } = autopilotInput({ ...start, x: 0, z: 0, heading: 0 }, [0, -10]);
  assert.equal(arrived, false);
  assert.ok(input.throttle > 0);
  assert.equal(autopilotInput({ ...start, x: 0, z: -9.9 }, [0, -10]).arrived, true);
});
