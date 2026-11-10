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
  throttle: number; // -1..1 (W/S or joystick Y)
  steer: number; // -1..1 (A/D or joystick X)
  brake: boolean;
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

/** Bicycle-model step with inertia: speed eases toward the target instead of snapping. */
export function stepVehicle(pose: Pose, input: DriveInput, dt: number, params: VehicleParams = TRACTOR_PARAMS): Pose {
  const clampedDt = Math.min(Math.max(dt, 0), 0.05);
  const targetSpeed = input.throttle >= 0 ? input.throttle * params.maxSpeed : input.throttle * params.maxReverse;
  let speed = pose.speed;
  if (input.brake) {
    const decel = params.brakeDecel * clampedDt;
    speed = Math.abs(speed) <= decel ? 0 : speed - Math.sign(speed) * decel;
  } else if (targetSpeed > speed) {
    speed = Math.min(targetSpeed, speed + params.accel * clampedDt);
  } else if (targetSpeed < speed) {
    speed = Math.max(targetSpeed, speed - params.accel * 1.4 * clampedDt);
  }
  // Rolling drag toward rest when no throttle.
  if (input.throttle === 0 && !input.brake) {
    const drag = params.drag * clampedDt;
    speed = Math.abs(speed) <= drag ? 0 : speed - Math.sign(speed) * drag;
  }
  const steerTarget = input.steer * params.maxSteer;
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
  if (dist < 0.35) return { input: { throttle: 0, steer: 0, brake: true }, arrived: true };
  const desired = Math.atan2(dx, -dz);
  let diff = desired - pose.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const throttle = dist > 2 ? 0.55 : 0.3;
  return { input: { throttle, steer: Math.max(-1, Math.min(1, diff * 1.6)), brake: false }, arrived: false };
}
