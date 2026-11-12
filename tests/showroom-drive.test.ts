import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilotInput, BOOST_MULTIPLIER, FIELD_PARAMS, hasManualInput, keysToDriveInput, planGuideRoute, resolveCollision, stepVehicle, steerAuthority, turnRadius, type Pose } from '../src/pages/ShowroomPage/showroom-drive';
import { CROP_PLOTS, cropHeight, cropPlotAt, cropPlotCount, FIELD_OBSTACLES, gripForWeather, QUALITY_TIERS, terrainHeight } from '../src/pages/ShowroomPage/showroom-data';

const start: Pose = { x: 0, z: 0, heading: 0, speed: 0, steer: 0 };

test('stepVehicle accelerates gradually (heavy feel) and caps at max speed', () => {
  let pose = start;
  for (let i = 0; i < 10; i++) pose = stepVehicle(pose, { throttle: 1, steer: 0, brake: false, boost: false }, 0.1);
  assert.ok(pose.speed > 0 && pose.speed < 6.5, `speed ${pose.speed}`);
  for (let i = 0; i < 60; i++) pose = stepVehicle(pose, { throttle: 1, steer: 0, brake: false, boost: false }, 0.1);
  assert.equal(pose.speed, 6.5);
});

test('brake stops the tractor and reverse is slower than forward', () => {
  let pose = { ...start, speed: 3 };
  for (let i = 0; i < 20; i++) pose = stepVehicle(pose, { throttle: 0, steer: 0, brake: true, boost: false }, 0.1);
  assert.equal(pose.speed, 0);
  let rev = start;
  for (let i = 0; i < 60; i++) rev = stepVehicle(rev, { throttle: -1, steer: 0, brake: false, boost: false }, 0.1);
  assert.equal(rev.speed, -2);
});

test('turn radius is wide at full steer (field-safe turning)', () => {
  const radius = turnRadius(2, 0.5);
  assert.ok(radius > 2 && radius < 10, `radius ${radius}`);
  assert.equal(turnRadius(2, 0), Number.POSITIVE_INFINITY);
});

test('resolveCollision never lets the tractor enter the diagnosis booth', () => {
  const prev: Pose = { ...start, x: 10, z: -10 };
  const next: Pose = { ...start, x: 16.5, z: -10, speed: 2 };
  const resolved = resolveCollision(next, prev);
  // Full move and x-only both hit the booth; z-only slides along it.
  assert.equal(resolved.x, 10);
  assert.ok(resolved.speed < 2, `speed ${resolved.speed}`);
});

test('planGuideRoute runs along the main aisle and ends at the dock', () => {
  const route = planGuideRoute({ x: -10, z: 4 }, 'diagnosis');
  assert.deepEqual(route[route.length - 1], [16.5, -5.2]);
  assert.ok(route.every(([, z]) => z === 0 || z === -5.2));
});

test('arrow keys are equivalent to WASD for driving (primary control)', () => {
  const joy = { x: 0, y: 0 };
  assert.deepEqual(keysToDriveInput(new Set(['ArrowUp']), joy), { throttle: 1, steer: 0, brake: false, boost: false });
  assert.deepEqual(keysToDriveInput(new Set(['KeyW']), joy), { throttle: 1, steer: 0, brake: false, boost: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowDown']), joy), { throttle: -1, steer: 0, brake: false, boost: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowLeft']), joy), { throttle: 0, steer: -1, brake: false, boost: false });
  assert.deepEqual(keysToDriveInput(new Set(['KeyA']), joy), { throttle: 0, steer: -1, brake: false, boost: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowRight']), joy), { throttle: 0, steer: 1, brake: false, boost: false });
  assert.deepEqual(keysToDriveInput(new Set(['Space']), joy), { throttle: 0, steer: 0, brake: true, boost: false });
  // Opposing keys cancel out instead of fighting.
  assert.deepEqual(keysToDriveInput(new Set(['ArrowUp', 'ArrowDown']), joy), { throttle: 0, steer: 0, brake: false, boost: false });
  assert.deepEqual(keysToDriveInput(new Set(['ArrowLeft', 'ArrowRight']), joy), { throttle: 0, steer: 0, brake: false, boost: false });
  // Arrows take over autopilot just like WASD.
  assert.equal(hasManualInput(new Set(['ArrowUp']), joy), true);
  assert.equal(hasManualInput(new Set(['ArrowLeft']), joy), true);
  assert.equal(hasManualInput(new Set(), joy), false);
});

test('brake stops from driving speed in under a second and holds at zero', () => {
  let pose = { ...start, speed: 3.2 };
  // dt is clamped to 0.05 inside stepVehicle: 13 steps = 0.65 s of sim time.
  for (let i = 0; i < 13; i++) pose = stepVehicle(pose, { throttle: 0, steer: 0, brake: true, boost: false }, 0.1);
  assert.equal(pose.speed, 0);
  // Holding brake with throttle still held does not creep forward.
  pose = stepVehicle(pose, { throttle: 1, steer: 0, brake: true }, 0.1);
  assert.equal(pose.speed, 0);
});

test('steering turns the tractor while moving, never while stationary', () => {
  let pose = start;
  for (let i = 0; i < 40; i++) pose = stepVehicle(pose, { throttle: 1, steer: 1, brake: false, boost: false }, 0.1);
  assert.ok(pose.heading > 0.2, `heading ${pose.heading}`);
  assert.ok(pose.speed > 0 && Math.hypot(pose.x, pose.z) > 1, `moved ${pose.x},${pose.z}`);
  const still = stepVehicle(start, { throttle: 0, steer: 1, brake: false, boost: false }, 0.1);
  assert.equal(still.heading, 0);
  // Reversing with the same steer input turns the other way.
  let rev = start;
  for (let i = 0; i < 40; i++) rev = stepVehicle(rev, { throttle: -1, steer: 1, brake: false, boost: false }, 0.1);
  assert.ok(rev.heading < -0.2, `rev heading ${rev.heading}`);
});

test('autopilotInput steers toward the waypoint and reports arrival', () => {
  const { input, arrived } = autopilotInput({ ...start, x: 0, z: 0, heading: 0 }, [0, -10]);
  assert.equal(arrived, false);
  assert.ok(input.throttle > 0);
  assert.equal(autopilotInput({ ...start, x: 0, z: -9.9 }, [0, -10]).arrived, true);
});

test('Shift boost lifts the field top speed', () => {
  assert.equal(keysToDriveInput(new Set(['ArrowUp', 'ShiftLeft']), { x: 0, y: 0 }).boost, true);
  assert.equal(keysToDriveInput(new Set(['ArrowUp']), { x: 0, y: 0 }).boost, false);
  let field = start;
  for (let i = 0; i < 200; i++) field = stepVehicle(field, { throttle: 1, steer: 0, brake: false, boost: true }, 0.1, FIELD_PARAMS);
  assert.ok(Math.abs(field.speed - FIELD_PARAMS.maxSpeed * BOOST_MULTIPLIER) < 0.01, `field boost ${field.speed}`);
  let plain = start;
  for (let i = 0; i < 200; i++) plain = stepVehicle(plain, { throttle: 1, steer: 0, brake: false, boost: false }, 0.1, FIELD_PARAMS);
  assert.equal(plain.speed, FIELD_PARAMS.maxSpeed);
});

test('wet and snow grip slow acceleration and lengthen the coast', () => {
  const dry = stepVehicle({ ...start, speed: 0 }, { throttle: 1, steer: 0, brake: false, boost: false }, 0.05, FIELD_PARAMS, { grip: 1 });
  const wet = stepVehicle({ ...start, speed: 0 }, { throttle: 1, steer: 0, brake: false, boost: false }, 0.05, FIELD_PARAMS, { grip: gripForWeather(1, 0) });
  const snowy = stepVehicle({ ...start, speed: 0 }, { throttle: 1, steer: 0, brake: false, boost: false }, 0.05, FIELD_PARAMS, { grip: gripForWeather(0.4, 1) });
  assert.ok(wet.speed < dry.speed && snowy.speed < wet.speed, `dry ${dry.speed} wet ${wet.speed} snow ${snowy.speed}`);
  assert.ok(gripForWeather(0, 0) === 1 && gripForWeather(0, 1) < gripForWeather(1, 0) && gripForWeather(1, 0) < 1);
  // Coasting on snow rolls further than on dry ground.
  let d = { ...start, speed: 3 };
  let s = { ...start, speed: 3 };
  for (let i = 0; i < 20; i++) {
    d = stepVehicle(d, { throttle: 0, steer: 0, brake: false, boost: false }, 0.05, FIELD_PARAMS, { grip: 1 });
    s = stepVehicle(s, { throttle: 0, steer: 0, brake: false, boost: false }, 0.05, FIELD_PARAMS, { grip: gripForWeather(0.4, 1) });
  }
  assert.ok(s.speed > d.speed, `coast dry ${d.speed} snow ${s.speed}`);
});

test('steering authority falls with speed, so the turn radius grows', () => {
  assert.equal(steerAuthority(0, 6.5), 1);
  assert.ok(steerAuthority(6.5, 6.5) < 0.6 && steerAuthority(6.5, 6.5) > 0.5);
  const slow = stepVehicle({ ...start, speed: 1 }, { throttle: 1, steer: 1, brake: false, boost: false }, 0.05, FIELD_PARAMS);
  const fast = stepVehicle({ ...start, speed: 6 }, { throttle: 1, steer: 1, brake: false, boost: false }, 0.05, FIELD_PARAMS);
  // Heading rate grows with speed, but far less than 6x (steer is reined in).
  assert.ok(fast.heading > slow.heading && fast.heading < slow.heading * 5, `slow ${slow.heading} fast ${fast.heading}`);
});

test('no hall walls: the old hall footprint is open field', () => {
  // No wall obstacles remain: only the three booths.
  assert.deepEqual(
    FIELD_OBSTACLES.map((o) => o.id).sort(),
    ['diag-booth', 'embodied-booth', 'kiosk'],
  );
  // The old east gate line (x = 14, z = 0) is open.
  const prev: Pose = { ...start, x: 12, z: 0 };
  const through: Pose = { ...start, x: 14, z: 0, speed: 2 };
  assert.equal(resolveCollision(through, prev).x, 14);
  // So is the old north wall line (z = -10) and the old west wall line (x = -14).
  const northPrev: Pose = { ...start, x: 0, z: -12 };
  const northNext: Pose = { ...start, x: 0, z: -10, speed: 2 };
  assert.equal(resolveCollision(northNext, northPrev).z, -10);
  const westPrev: Pose = { ...start, x: -16, z: 0 };
  const westNext: Pose = { ...start, x: -14, z: 0, speed: 2 };
  assert.equal(resolveCollision(westNext, westPrev).x, -14);
  // One driving profile everywhere: the default step caps at the field speed.
  let pose = start;
  for (let i = 0; i < 70; i++) pose = stepVehicle(pose, { throttle: 1, steer: 0, brake: false, boost: false }, 0.1);
  assert.equal(pose.speed, FIELD_PARAMS.maxSpeed);
});

test('crop plots cover rice/wheat/corn at different stages, off the track', () => {
  assert.equal(CROP_PLOTS.length, 6);
  const kinds = new Set(CROP_PLOTS.map((p) => p.crop));
  assert.deepEqual([...kinds].sort(), ['corn', 'rice', 'wheat']);
  assert.ok(new Set(CROP_PLOTS.map((p) => p.stage)).size > 3, 'stages differ');
  for (const plot of CROP_PLOTS) {
    const [minX, minZ, maxX, maxZ] = plot.bounds;
    assert.ok(minZ >= 8 || maxZ <= -8, `${plot.id} keeps off the track`);
    assert.ok(cropPlotCount(plot) > 100, `${plot.id} count ${cropPlotCount(plot)}`);
  }
  assert.equal(cropPlotAt(-20, -14)?.crop, 'rice');
  assert.equal(cropPlotAt(20, -14)?.crop, 'wheat');
  assert.equal(cropPlotAt(-20, 14)?.crop, 'corn');
  assert.equal(cropPlotAt(0, 0), undefined);
  assert.ok(cropHeight('corn', 0.9) > cropHeight('rice', 0.45));
  assert.ok(cropHeight('wheat', 0.8) > cropHeight('wheat', 0.35));
});

test('terrain is flat on the track, gently rolling in the field', () => {
  assert.equal(terrainHeight(0, 0), 0);
  assert.equal(terrainHeight(10, 0), 0);
  assert.ok(Math.abs(terrainHeight(25, -15)) <= 0.7, `field ${terrainHeight(25, -15)}`);
  let maxAbs = 0;
  for (let x = -28; x <= 28; x += 2) {
    for (let z = -20; z <= 20; z += 2) maxAbs = Math.max(maxAbs, Math.abs(terrainHeight(x, z)));
  }
  assert.ok(maxAbs > 0.2 && maxAbs <= 0.7, `field undulation max ${maxAbs}`);
});

test('quality tiers thin the crops on low (frame-rate guard)', () => {
  assert.equal(QUALITY_TIERS.high.crops, 1);
  assert.ok(QUALITY_TIERS.medium.crops < 1 && QUALITY_TIERS.low.crops < QUALITY_TIERS.medium.crops);
  assert.ok(QUALITY_TIERS.low.crops <= 0.4);
});
