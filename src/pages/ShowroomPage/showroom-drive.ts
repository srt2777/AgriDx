/**
 * Pure driving / walking maths for the showroom. No three.js, no Rapier —
 * the same step functions are unit-tested here and reused by the scene.
 * Rapier (see rapier-vehicle.ts) owns collision at runtime; these helpers
 * provide the kinematic model, the hall-bounds clamp used as a fallback,
 * and the guide-line autopilot path.
 */
import { HALL, HALL_OBSTACLES, type ZoneId } from './showroom-data';

export interface Pose {
  x: number;
  z: number;
  /** Heading in radians; 0 faces -z (north). */
  heading: number;
  /** Speed in m/s (signed: forward positive). */
  speed: number;
  /** Front-wheel steer angle in radians. */
  steer: number;
}

export interface DriveInput {
  throttle: number; // -1..1 (↑/↓ or W/S, or joystick Y)
  steer: number; // -1..1 (←/→ or A/D, or joystick X)
  brake: boolean;
  /** Shift held: boost (field top speed ×1.35, hall stays capped). */
  boost: boolean;
}

/** Arrow keys are the primary drive/walk control; WASD is an alias. */
export const ARROW_CODES = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

/** Walk input from the held key set: forward/strafe in -1..1. */
export function keysToWalkInput(keys: ReadonlySet<string>, joy: { x: number; y: number }): { forward: number; strafe: number } {
  const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + -joy.y;
  const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
  return { forward, strafe };
}

/** Drive input from the held key set; arrows and WASD are equivalent. */
export function keysToDriveInput(keys: ReadonlySet<string>, joy: { x: number; y: number }): DriveInput {
  return {
    throttle: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + -joy.y,
    steer: (keys.has('KeyA') || keys.has('ArrowLeft') ? -1 : 0) + (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) + joy.x,
    brake: keys.has('Space'),
    boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

/** True when any manual drive/walk key (or the joystick) is active. */
export function hasManualInput(keys: ReadonlySet<string>, joy: { x: number; y: number }): boolean {
  return keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyA') || keys.has('KeyD')
    || keys.has('ArrowUp') || keys.has('ArrowDown') || keys.has('ArrowLeft') || keys.has('ArrowRight')
    || keys.has('Space') || Math.abs(joy.x) > 0.15 || Math.abs(joy.y) > 0.15;
}

export interface VehicleParams {
  /** Top speed m/s — deliberately slow for an indoor hall. */
  maxSpeed: number;
  /** Max reverse speed m/s. */
  maxReverse: number;
  accel: number;
  brakeDecel: number;
  drag: number;
  maxSteer: number;
  wheelBase: number;
}

export const TRACTOR_PARAMS: VehicleParams = {
  maxSpeed: 3.2,
  maxReverse: 1.2,
  accel: 1.6,
  brakeDecel: 6,
  drag: 0.9,
  maxSteer: 0.5,
  wheelBase: 2.4,
};

export const WALK_PARAMS = { speed: 2.2, accel: 14, radius: 0.45 } as const;
export const TRACTOR_RADIUS = 1.9;

/**
 * Field driving: faster than the hall (6.5 m/s ≈ 23 km/h) but still
 * sedate for a tractor; reverse stays slow. Boost (Shift) lifts the
 * field top speed ×1.35 and never applies inside the hall.
 */
export const FIELD_PARAMS: VehicleParams = {
  maxSpeed: 6.5,
  maxReverse: 2,
  accel: 2.2,
  brakeDecel: 5,
  drag: 0.7,
  maxSteer: 0.42,
  wheelBase: 2.4,
};

/** Boost multiplier on the field top speed (hall is never boosted). */
export const BOOST_MULTIPLIER = 1.35;

export interface StepOptions {
  /** Surface grip 0..1 (wet/snow lower it): scales accel, eases drag. */
  grip?: number;
}

/** Bicycle-model step with inertia: speed eases toward the target instead of snapping. */
export function stepVehicle(pose: Pose, input: DriveInput, dt: number, params: VehicleParams = TRACTOR_PARAMS, opts: StepOptions = {}): Pose {
  const clampedDt = Math.min(Math.max(dt, 0), 0.05);
  const grip = Math.min(1, Math.max(0.5, opts.grip ?? 1));
  const boost = input.boost && params.maxSpeed > TRACTOR_PARAMS.maxSpeed;
  const topSpeed = boost ? params.maxSpeed * BOOST_MULTIPLIER : params.maxSpeed;
  const targetSpeed = input.throttle >= 0 ? input.throttle * topSpeed : input.throttle * params.maxReverse;
  let speed = pose.speed;
  if (input.brake) {
    const decel = params.brakeDecel * grip * clampedDt;
    speed = Math.abs(speed) <= decel ? 0 : speed - Math.sign(speed) * decel;
  } else if (targetSpeed > speed) {
    speed = Math.min(targetSpeed, speed + params.accel * grip * clampedDt);
  } else if (targetSpeed < speed) {
    speed = Math.max(targetSpeed, speed - params.accel * 1.4 * grip * clampedDt);
  }
  // Rolling drag toward rest when no throttle; less grip = longer coast.
  if (input.throttle === 0 && !input.brake) {
    const drag = params.drag * grip * clampedDt;
    speed = Math.abs(speed) <= drag ? 0 : speed - Math.sign(speed) * drag;
  }
  const steerTarget = input.steer * params.maxSteer * steerAuthority(speed, topSpeed);
  const steer = pose.steer + (steerTarget - pose.steer) * Math.min(1, clampedDt * 6);
  // Bicycle model: heading rate grows with speed and steer, wheelbase caps the turn.
  const heading = pose.heading + (speed / params.wheelBase) * Math.tan(steer) * clampedDt;
  const x = pose.x + Math.sin(heading) * speed * clampedDt;
  const z = pose.z - Math.cos(heading) * speed * clampedDt;
  return { x, z, heading, speed, steer };
}

/** Turn radius for a given speed/steer (metres); Infinity when straight. */
export function turnRadius(speed: number, steer: number, params: VehicleParams = TRACTOR_PARAMS): number {
  const angle = Math.abs(steer);
  if (angle < 1e-4 || Math.abs(speed) < 1e-4) return Number.POSITIVE_INFINITY;
  return params.wheelBase / Math.tan(angle);
}

/**
 * Steering authority falls as speed rises (up to −45% at top speed), so
 * the turn radius grows with speed: the tractor stays sedate in the
 * field instead of spinning at 6 m/s. Applied in stepVehicle + Rapier.
 */
export function steerAuthority(speed: number, topSpeed: number): number {
  if (topSpeed <= 0) return 1;
  return 1 - Math.min(0.45, (Math.abs(speed) / topSpeed) * 0.45);
}

function collides(x: number, z: number, radius: number): boolean {
  if (Math.abs(x) + radius > HALL.halfX || Math.abs(z) + radius > HALL.halfZ) return true;
  return HALL_OBSTACLES.some(({ box: [minX, minZ, maxX, maxZ] }) => {
    const cx = Math.min(Math.max(x, minX), maxX);
    const cz = Math.min(Math.max(z, minZ), maxZ);
    const dx = x - cx;
    const dz = z - cz;
    return dx * dx + dz * dz < radius * radius;
  });
}

/**
 * Resolve a proposed pose against the hall: try full move, then x-only,
 * then z-only, then stop — so the tractor slides along booths instead of
 * sticking, and never clips through (fallback when Rapier is unavailable).
 */
export function resolveCollision(next: Pose, prev: Pose, radius: number = TRACTOR_RADIUS): Pose {
  if (!collides(next.x, next.z, radius)) return next;
  if (!collides(next.x, prev.z, radius)) return { ...next, z: prev.z, speed: next.speed * 0.4 };
  if (!collides(prev.x, next.z, radius)) return { ...next, x: prev.x, speed: next.speed * 0.4 };
  return { ...prev, speed: 0, steer: next.steer };
}

/** Clamp a walker position to the hall with the same obstacle set. */
export function clampWalk(x: number, z: number, radius: number = WALK_PARAMS.radius): { x: number; z: number } {
  let nx = Math.min(Math.max(x, -HALL.halfX + radius), HALL.halfX - radius);
  let nz = Math.min(Math.max(z, -HALL.halfZ + radius), HALL.halfZ - radius);
  for (const { box } of HALL_OBSTACLES) {
    const [minX, minZ, maxX, maxZ] = box;
    const cx = Math.min(Math.max(nx, minX), maxX);
    const cz = Math.min(Math.max(nz, minZ), maxZ);
    const dx = nx - cx;
    const dz = nz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * radius;
        nz = cz + (dz / d) * radius;
      } else {
        nz = minZ - radius;
      }
    }
  }
  return { x: nx, z: nz };
}

/**
 * Autopilot route: waypoints along the main aisle (z = 0 guide line) from
 * the current pose to a zone dock, then a final approach into the dock.
 * The aisle is clear by construction (obstacles sit off the aisle).
 */
export function planGuideRoute(from: { x: number; z: number }, zoneId: ZoneId): [number, number][] {
  const docks: Record<ZoneId, [number, number]> = {
    tractor: [7.2, 0],
    diagnosis: [16.5, -5.2],
    embodied: [-16.5, -5.2],
    agridex: [16.5, 5.2],
  };
  const [dx, dz] = docks[zoneId];
  const points: [number, number][] = [];
  if (Math.abs(from.z) > 0.6) points.push([from.x, 0]);
  if (Math.abs(dx - (points.length ? points[points.length - 1][0] : from.x)) > 0.6) points.push([dx, 0]);
  points.push([dx, dz]);
  return points;
}

/** Step the autopilot toward the next waypoint; returns the drive input. */
export function autopilotInput(
  pose: Pose,
  waypoint: [number, number],
): { input: DriveInput; arrived: boolean } {
  const dx = waypoint[0] - pose.x;
  const dz = waypoint[1] - pose.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.35) return { input: { throttle: 0, steer: 0, brake: true, boost: false }, arrived: true };
  const desired = Math.atan2(dx, -dz);
  let diff = desired - pose.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const throttle = dist > 2 ? 0.55 : 0.3;
  return { input: { throttle, steer: Math.max(-1, Math.min(1, diff * 1.6)), brake: false, boost: false }, arrived: false };
}
