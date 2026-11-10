/**
 * Mutable simulation state shared between the HUD (ShowroomPage) and the
 * 3D scene (ShowroomScene). Kept in a ref — not React state — so the
 * 60 fps loop never re-renders the DOM; the HUD polls it on a timer.
 */
import type { ZoneId } from './showroom-data';
import type { Pose } from './showroom-drive';

export type ShowroomMode = 'walk' | 'drive' | 'fly';
export type DriveView = 'follow' | 'cabin';

export interface SimState {
  mode: ShowroomMode;
  driveView: DriveView;
  /** First-person walker pose. */
  walk: { x: number; z: number; yaw: number; pitch: number };
  tractor: Pose;
  keys: Set<string>;
  /** Touch joystick -1..1 (x = steer, y = throttle). */
  joystick: { x: number; y: number };
  /** Active camera fly-to; null when idle. */
  flyTo: { pos: [number, number, number]; look: [number, number, number]; t: number } | null;
  /** Zone card currently open in the HUD. */
  focusZone: ZoneId | null;
  /** Autopilot waypoints; null = manual control. */
  autopilot: { route: [number, number][]; index: number } | null;
  /** Wheel spin accumulator (radians) and front steer visual. */
  wheelSpin: number;
  /** Whether the Rapier backend initialised (false = kinematic fallback). */
  rapierReady: boolean;
  /** Radar sweep angle (radians). */
  radarAngle: number;
  /** Diagnosis-robot demo phase 0..2 (detect/locate/diagnose). */
  diagPhase: number;
  /** Elapsed seconds since the scene mounted. */
  elapsed: number;
}

export function createSim(): SimState {
  return {
    mode: 'walk',
    driveView: 'follow',
    walk: { x: 0, z: 11, yaw: 0, pitch: 0 },
    tractor: { x: 0, z: 0, heading: Math.PI / 2, speed: 0, steer: 0 },
    keys: new Set(),
    joystick: { x: 0, y: 0 },
    flyTo: null,
    focusZone: null,
    autopilot: null,
    wheelSpin: 0,
    rapierReady: false,
    radarAngle: 0,
    diagPhase: 0,
    elapsed: 0,
  };
}
