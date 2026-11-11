/**
 * Rapier raycast-vehicle controller.
 *
 * Rapier itself ships no vehicle controller, so this module builds one on
 * top of @dimforge/rapier3d-compat (Apache-2.0, lazy-loaded so the rest of
 * the app never pays for the WASM bundle):
 *  - a static world: floor + field-edge bound colliders + one cuboid
 *    collider per field obstacle (booths / platform), so the tractor
 *    genuinely collides instead of clipping through;
 *  - the tractor as a dynamic cuboid rigid body, driven by capped
 *    acceleration / steering (low speed, heavy feel, wide turn radius);
 *  - a raycast per wheel, cast straight down from each wheel hub, which
 *    measures suspension travel and reports ground contact — the raycast
 *    half of the controller, used for wheel compression visuals and for
 *    cutting drive force when a wheel leaves the ground.
 * The pure kinematic fallback in showroom-drive.ts is used if Rapier fails
 * to initialise (e.g. no WASM support); the scene reports which backend is
 * active.
 */
import { HALL, HALL_BUILDING, HALL_OBSTACLES, isInsideHall } from './showroom-data';
import { FIELD_PARAMS, TRACTOR_PARAMS, steerAuthority, type DriveInput, type Pose, type StepOptions } from './showroom-drive';

export interface WheelRay {
  /** Suspension compression 0..1 (1 = fully compressed). */
  compression: number;
  grounded: boolean;
}

export interface RapierVehicle {
  step(input: DriveInput, dt: number, opts?: StepOptions): { pose: Pose; wheels: WheelRay[] };
  setPose(pose: Pose): void;
  dispose(): void;
}

const WHEEL_OFFSETS: [number, number][] = [
  [-0.85, -1.05], // front-left  (x = lateral, z = longitudinal)
  [0.85, -1.05], // front-right
  [-0.85, 1.05], // rear-left
  [0.85, 1.05], // rear-right
];

export async function createRapierVehicle(initial: Pose): Promise<RapierVehicle> {
  const RAPIER = await import('@dimforge/rapier3d-compat');
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const floor = RAPIER.ColliderDesc.cuboid(HALL.halfX + 2, 0.5, HALL.halfZ + 2).setTranslation(0, -0.5, 0);
  world.createCollider(floor);
  const wallThickness = 0.5;
  const wallY = HALL.height / 2;
  const walls: [number, number, number, number, number, number][] = [
    [HALL.halfX + wallThickness / 2, wallY, 0, wallThickness / 2, wallY, HALL.halfZ + 1],
    [-(HALL.halfX + wallThickness / 2), wallY, 0, wallThickness / 2, wallY, HALL.halfZ + 1],
    [0, wallY, HALL.halfZ + wallThickness / 2, HALL.halfX + 1, wallY, wallThickness / 2],
    [0, wallY, -(HALL.halfZ + wallThickness / 2), HALL.halfX + 1, wallY, wallThickness / 2],
  ];
  for (const [x, y, z, hx, hy, hz] of walls) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
  }
  // Glass hall walls (height HALL_BUILDING.height, thin colliders). The
  // east wall is two segments with the gate gap between them, so the
  // tractor can drive out onto the field track and back in.
  const hw = HALL_BUILDING.halfX;
  const hz = HALL_BUILDING.halfZ;
  const hh = HALL_BUILDING.height / 2;
  const gate = HALL_BUILDING.gate.halfWidth;
  const hallWalls: [number, number, number, number, number, number][] = [
    [0, hh, -hz, hw + 0.15, hh, 0.15], // north
    [0, hh, hz, hw + 0.15, hh, 0.15], // south
    [-hw, hh, 0, 0.15, hh, hz + 0.15], // west
    [hw, hh, -(gate + (hz - gate) / 2), 0.15, hh, (hz - gate) / 2], // east, north of gate
    [hw, hh, gate + (hz - gate) / 2, 0.15, hh, (hz - gate) / 2], // east, south of gate
    // Lintel above the gate (gate opening is 4.2 m tall).
    [hw, 4.2 + (HALL_BUILDING.height - 4.2) / 2, 0, 0.15, (HALL_BUILDING.height - 4.2) / 2, gate],
  ];
  for (const [x, y, z, hx, hy, hz2] of hallWalls) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz2).setTranslation(x, y, z));
  }
  for (const obstacle of HALL_OBSTACLES) {
    const [minX, minZ, maxX, maxZ] = obstacle.box;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    world.createCollider(
      RAPIER.ColliderDesc.cuboid((maxX - minX) / 2, 1.6, (maxZ - minZ) / 2).setTranslation(cx, 1.6, cz),
    );
  }
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(initial.x, 0.9, initial.z)
    .setLinearDamping(1.2)
    .setAngularDamping(4)
    .lockRotations();
  const body = world.createRigidBody(bodyDesc);
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.15, 0.9, 1.9).setDensity(1.2), body);

  let pose: Pose = { ...initial };

  function castWheels(): WheelRay[] {
    return WHEEL_OFFSETS.map(([ox, oz]) => {
      const cos = Math.cos(pose.heading);
      const sin = Math.sin(pose.heading);
      const wx = pose.x + ox * cos + oz * sin;
      const wz = pose.z - ox * sin + oz * cos;
      const ray = new RAPIER.Ray({ x: wx, y: 1.1, z: wz }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 1.4, true);
      if (!hit) return { compression: 0, grounded: false };
      const travel = Math.min(1, Math.max(0, 1 - hit.timeOfImpact / 1.4));
      return { compression: travel, grounded: hit.timeOfImpact < 1.2 };
    });
  }

  return {
    step(input: DriveInput, dt: number, opts: StepOptions = {}) {
      const clampedDt = Math.min(Math.max(dt, 0), 0.05);
      const wheels = castWheels();
      const groundedWheels = wheels.filter((w) => w.grounded).length;
      // No drive force when fewer than two wheels touch the ground.
      const grip = groundedWheels >= 2 ? 1 : 0;
      // Hall vs field: the hall caps speed at 3.2 m/s; the field allows
      // 6.5 m/s and Shift boost. Wet/snow scale accel and braking.
      const params = isInsideHall(pose.x, pose.z) ? TRACTOR_PARAMS : FIELD_PARAMS;
      const surfaceGrip = Math.min(1, Math.max(0.5, opts.grip ?? 1));
      const boost = input.boost && params.maxSpeed > TRACTOR_PARAMS.maxSpeed;
      const topSpeed = boost ? params.maxSpeed * 1.35 : params.maxSpeed;
      const targetSpeed = input.throttle >= 0 ? input.throttle * topSpeed : input.throttle * params.maxReverse;
      let speed = pose.speed;
      if (input.brake) {
        const decel = params.brakeDecel * surfaceGrip * clampedDt;
        speed = Math.abs(speed) <= decel ? 0 : speed - Math.sign(speed) * decel;
      } else if (grip > 0) {
        if (targetSpeed > speed) speed = Math.min(targetSpeed, speed + params.accel * surfaceGrip * clampedDt);
        else if (targetSpeed < speed) speed = Math.max(targetSpeed, speed - params.accel * 1.4 * surfaceGrip * clampedDt);
      }
      if (input.throttle === 0 && !input.brake) {
        const drag = params.drag * surfaceGrip * clampedDt;
        speed = Math.abs(speed) <= drag ? 0 : speed - Math.sign(speed) * drag;
      }
      const steerTarget = input.steer * params.maxSteer * steerAuthority(speed, topSpeed);
      const steer = pose.steer + (steerTarget - pose.steer) * Math.min(1, clampedDt * 6);
      const headingRate = (speed / params.wheelBase) * Math.tan(steer);
      const heading = pose.heading + headingRate * clampedDt;
      const vx = Math.sin(heading) * speed;
      const vz = -Math.cos(heading) * speed;
      // Drive the Rapier body by velocity; Rapier resolves wall/booth contact.
      body.setLinvel({ x: vx, y: 0, z: vz }, true);
      body.setAngvel({ x: 0, y: headingRate, z: 0 }, true);
      // Rapier advances its world by one fixed 1/60 s step per world.step()
      // call, regardless of the render frame time. At low frame rates a
      // single step would move the body only 1/60 s per frame while the
      // speedometer (integrated with clampedDt) ran at full rate — the
      // tractor crawled, turned faster than it travelled, and braking felt
      // disconnected from the speed shown. Sub-step so the body covers the
      // same simulated time as the kinematic integration above.
      const steps = Math.max(1, Math.round(clampedDt / (1 / 60)));
      for (let i = 0; i < steps; i += 1) world.step();
      const t = body.translation();
      const next: Pose = { x: t.x, z: t.z, heading, speed, steer };
      // Keep the visual heading authoritative; Rapier position is authoritative
      // for collision (it slides along walls instead of passing through).
      pose = next;
      return { pose: next, wheels: castWheels() };
    },
    setPose(next: Pose) {
      pose = { ...next };
      body.setTranslation({ x: next.x, y: 0.9, z: next.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },
    dispose() {
      world.free();
    },
  };
}
