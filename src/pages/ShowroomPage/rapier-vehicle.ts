/**
 * Rapier raycast-vehicle controller.
 *
 * Rapier itself ships no vehicle controller, so this module builds one on
 * top of @dimforge/rapier3d-compat (Apache-2.0, lazy-loaded so the rest of
 * the app never pays for the WASM bundle):
 *  - a static world: floor + wall colliders + one cuboid collider per hall
 *    obstacle (booths / platform / planters), so the tractor genuinely
 *    collides instead of clipping through;
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
import { HALL, HALL_OBSTACLES } from './showroom-data';
import { TRACTOR_PARAMS, type DriveInput, type Pose } from './showroom-drive';

export interface WheelRay {
  /** Suspension compression 0..1 (1 = fully compressed). */
  compression: number;
  grounded: boolean;
}

export interface RapierVehicle {
  step(input: DriveInput, dt: number): { pose: Pose; wheels: WheelRay[] };
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
    step(input: DriveInput, dt: number) {
      const clampedDt = Math.min(Math.max(dt, 0), 0.05);
      const wheels = castWheels();
      const groundedWheels = wheels.filter((w) => w.grounded).length;
      // No drive force when fewer than two wheels touch the ground.
      const grip = groundedWheels >= 2 ? 1 : 0;
      const targetSpeed = input.throttle >= 0 ? input.throttle * TRACTOR_PARAMS.maxSpeed : input.throttle * TRACTOR_PARAMS.maxReverse;
      let speed = pose.speed;
      if (input.brake) {
        const decel = TRACTOR_PARAMS.brakeDecel * clampedDt;
        speed = Math.abs(speed) <= decel ? 0 : speed - Math.sign(speed) * decel;
      } else if (grip > 0) {
        if (targetSpeed > speed) speed = Math.min(targetSpeed, speed + TRACTOR_PARAMS.accel * clampedDt);
        else if (targetSpeed < speed) speed = Math.max(targetSpeed, speed - TRACTOR_PARAMS.accel * 1.4 * clampedDt);
      }
      if (input.throttle === 0 && !input.brake) {
        const drag = TRACTOR_PARAMS.drag * clampedDt;
        speed = Math.abs(speed) <= drag ? 0 : speed - Math.sign(speed) * drag;
      }
      const steerTarget = input.steer * TRACTOR_PARAMS.maxSteer;
      const steer = pose.steer + (steerTarget - pose.steer) * Math.min(1, clampedDt * 6);
      const headingRate = (speed / TRACTOR_PARAMS.wheelBase) * Math.tan(steer);
      const heading = pose.heading + headingRate * clampedDt;
      const vx = Math.sin(heading) * speed;
      const vz = -Math.cos(heading) * speed;
      // Drive the Rapier body by velocity; Rapier resolves wall/booth contact.
      body.setLinvel({ x: vx, y: 0, z: vz }, true);
      body.setAngvel({ x: 0, y: headingRate, z: 0 }, true);
      world.step();
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
