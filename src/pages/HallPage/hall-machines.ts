import { HALL_EXAMPLE_DEVICES, type HallDeviceStatus } from './hall-example-data';

/** Same hues as the hall status chips, so the floor halo matches the table. */
export const STATUS_HALO: Record<HallDeviceStatus, string> = {
  online: '#7dffa8',
  standby: '#9fd4ff',
  maintenance: '#ffd36a',
  offline: '#c5d0da',
};

export const HALL_FLOOR = { width: 24, depth: 16 };
/** About 8 frames a second. The hall stays on demand rendering between ticks. */
export const HALL_IDLE_INTERVAL_MS = 120;

export type ExhibitKind = 'rig' | 'seeder' | 'harvester' | 'combine' | 'drone' | 'rover';

export const EXHIBITS: readonly {
  id: string;
  kind: ExhibitKind;
  position: [number, number, number];
  rotation: number;
  scale: number;
  accent?: string;
}[] = [
  { id: 'a1', kind: 'rig', position: [-6.55, 0, -3.9], rotation: 0.5, scale: 1.08, accent: '#d94a3a' },
  { id: 'a2', kind: 'rig', position: [-4.05, 0, -2.2], rotation: -0.72, scale: 0.92, accent: '#2f7d46' },
  { id: 'b2', kind: 'rig', position: [4.05, 0, -3.75], rotation: 2.4, scale: 1, accent: '#e07a2f' },
  { id: 'b3', kind: 'seeder', position: [6.55, 0, -2.15], rotation: 2.05, scale: 1 },
  { id: 'c3', kind: 'harvester', position: [-6.55, 0, 3.95], rotation: 0.42, scale: 1 },
  { id: 'c1', kind: 'combine', position: [-3.95, 0, 2.4], rotation: -0.5, scale: 1 },
  { id: 'd1', kind: 'drone', position: [4.35, 0, 2.55], rotation: 0.3, scale: 1 },
  { id: 'd3', kind: 'rover', position: [6.6, 0, 4.05], rotation: 2.55, scale: 1 },
];

/** Parts a still frame must show. Motion is separate and optional. */
export const MACHINE_PARTS: Record<ExhibitKind, readonly string[]> = {
  rig: ['cab', 'wheel', 'exhaust'],
  seeder: ['hopper', 'wheel'],
  harvester: ['header', 'reel'],
  combine: ['header', 'reel'],
  drone: ['rotor'],
  rover: ['sensor'],
};

export function exhibitStatus(id: string): HallDeviceStatus {
  return HALL_EXAMPLE_DEVICES.find((device) => device.id === id)?.status ?? 'offline';
}

export function floorAoUv(x: number, z: number): { u: number; v: number } {
  return {
    u: (x + HALL_FLOOR.width / 2) / HALL_FLOOR.width,
    v: (z + HALL_FLOOR.depth / 2) / HALL_FLOOR.depth,
  };
}

/** Idle motion is opt-in, and it stops for reduced motion or a hidden tab. */
export function idleMotionAllowed(options: { enabled: boolean; reduced: boolean; hidden: boolean }): boolean {
  return options.enabled && !options.reduced && !options.hidden;
}
