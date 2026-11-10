import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilotInput, clampWalk, hasManualInput, keysToDriveInput, keysToWalkInput, planGuideRoute, resolveCollision, stepVehicle, turnRadius, type Pose } from '../src/pages/ShowroomPage/showroom-drive';

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

test('arrow keys are equivalent to WASD for driving (primary control)', () => {
  const joy = { x: 0, y: 0 };
  assert.deepEqual(keysToDriveInput(new Set(['ArrowUp']), joy), { throttle: 1, steer: 0, brake: false });
  assert.deepEqual(keysToDriveInput(new Set(['KeyW']), joy), { throttle: 1, steer: 0, brake: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowDown']), joy), { throttle: -1, steer: 0, brake: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowLeft']), joy), { throttle: 0, steer: -1, brake: false });
  assert.deepEqual(keysToDriveInput(new Set(['KeyA']), joy), { throttle: 0, steer: -1, brake: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowRight']), joy), { throttle: 0, steer: 1, brake: false });
  assert.deepEqual(keysToDriveInput(new Set(['Space']), joy), { throttle: 0, steer: 0, brake: true });
  // Opposing keys cancel out instead of fighting.
  assert.deepEqual(keysToDriveInput(new Set(['ArrowUp', 'ArrowDown']), joy), { throttle: 0, steer: 0, brake: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowLeft', 'ArrowRight']), joy), { throttle: 0, steer: 0, brake: false });
  // Arrows take over autopilot just like WASD.
  assert.equal(hasManualInput(new Set(['ArrowUp']), joy), true);
  assert.equal(hasManualInput(new Set(['ArrowLeft']), joy), true);
  assert.equal(hasManualInput(new Set(), joy), false);
  // Same equivalence for walking.
  assert.deepEqual(keysToWalkInput(new Set(['ArrowUp']), joy), { forward: 1, strafe: 0 });
  assert.deepEqual(keysToWalkInput(new Set(['ArrowRight']), joy), { forward: 0, strafe: 1 });
});

test('brake stops from top speed in under a second and holds at zero', () => {
  let pose = { ...start, speed: 3.2 };
  // dt is clamped to 0.05 inside stepVehicle: 11 steps = 0.55 s of sim time.
  for (let i = 0; i < 11; i++) pose = stepVehicle(pose, { throttle: 0, steer: 0, brake: true }, 0.1);
  assert.equal(pose.speed, 0);
  // Holding brake with throttle still held does not creep forward.
  pose = stepVehicle(pose, { throttle: 1, steer: 0, brake: true }, 0.1);
  assert.equal(pose.speed, 0);
});

test('steering turns the tractor while moving, never while stationary', () => {
  let pose = start;
  for (let i = 0; i < 40; i++) pose = stepVehicle(pose, { throttle: 1, steer: 1, brake: false }, 0.1);
  assert.ok(pose.heading > 0.2, `heading ${pose.heading}`);
  assert.ok(pose.speed > 0 && Math.hypot(pose.x, pose.z) > 1, `moved ${pose.x},${pose.z}`);
  const still = stepVehicle(start, { throttle: 0, steer: 1, brake: false }, 0.1);
  assert.equal(still.heading, 0);
  // Reversing with the same steer input turns the other way.
  let rev = start;
  for (let i = 0; i < 40; i++) rev = stepVehicle(rev, { throttle: -1, steer: 1, brake: false }, 0.1);
  assert.ok(rev.heading < -0.2, `rev heading ${rev.heading}`);
});

test('autopilotInput steers toward the waypoint and reports arrival', () => {
  const { input, arrived } = autopilotInput({ ...start, x: 0, z: 0, heading: 0 }, [0, -10]);
  assert.equal(arrived, false);
  assert.ok(input.throttle > 0);
  assert.equal(autopilotInput({ ...start, x: 0, z: -9.9 }, [0, -10]).arrived, true);
});
