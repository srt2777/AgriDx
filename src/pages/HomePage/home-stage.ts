/** Scroll poses for the old-home T70 stage. Pure module: no three.js, safe to unit test. */

export type StagePose = {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  pitch: number;
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  explode: number;
  turn: number;
  focus: string | null;
};

export type Beat = {
  id: string;
  pose: StagePose;
};

const NUMERIC_KEYS = [
  'x', 'y', 'z', 'scale', 'yaw', 'pitch',
  'camX', 'camY', 'camZ', 'lookX', 'lookY', 'lookZ',
  'explode', 'turn',
] as const satisfies readonly (keyof StagePose)[];

export function smoothstep(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export function damp(current: number, target: number, delta: number, lambda: number): number {
  if (!(delta > 0) || !(lambda > 0)) return current;
  const alpha = 1 - Math.exp(-delta * lambda);
  return current + (target - current) * alpha;
}

function pose(partial: Partial<StagePose> & Pick<StagePose, 'x' | 'scale' | 'yaw'>): StagePose {
  return {
    y: 0,
    z: 0,
    pitch: 0,
    camX: 2.7,
    camY: 1.25,
    camZ: 3.45,
    lookX: 0,
    lookY: 0.04,
    lookZ: 0,
    explode: 0,
    turn: 0,
    focus: null,
    ...partial,
  };
}

/** Desktop: hero turn, side slides, part zooms, a light explode, then a settle. */
export const DESKTOP_BEATS: readonly Beat[] = [
  {
    id: 'hero',
    pose: pose({
      x: 0.95, scale: 1.24, yaw: 0.62, turn: 0.16,
      camX: 2.35, camY: 1.15, camZ: 3.55, lookX: 0.55, lookY: 0.02,
    }),
  },
  {
    id: 'capabilities',
    pose: pose({
      x: 1.15, scale: 1.02, yaw: 0.38, turn: 0.06,
      camX: 2.6, camY: 1.3, camZ: 3.9, lookX: 0.72,
    }),
  },
  {
    id: 'painpoints',
    pose: pose({
      x: 1.22, scale: 1.48, yaw: 0.88, focus: 'body_shell',
      camX: 1.7, camY: 1.02, camZ: 2.45, lookX: 0.82, lookY: 0.08,
    }),
  },
  {
    id: 'knowledge',
    pose: pose({
      x: -1.18, scale: 1.58, yaw: -0.52, focus: 'gps_antenna',
      camX: -1.35, camY: 1.72, camZ: 2.25, lookX: -0.72, lookY: 0.42,
    }),
  },
  {
    id: 'techroute',
    pose: pose({
      x: 1.16, scale: 1.72, yaw: 1.12, focus: 'wheel_fl',
      camX: 2.05, camY: 0.48, camZ: 2.05, lookX: 0.78, lookY: -0.18,
    }),
  },
  {
    id: 'research',
    pose: pose({
      x: -1.08, scale: 1.5, yaw: -0.92, focus: 'sensor_roof_l',
      camX: -1.55, camY: 1.58, camZ: 2.35, lookX: -0.68, lookY: 0.38,
    }),
  },
  {
    id: 'scenarios',
    pose: pose({
      x: 1.02, scale: 1.42, yaw: 0.32, focus: 'battery_box',
      camX: 1.85, camY: 1.12, camZ: 2.3, lookX: 0.62, lookY: 0.1,
    }),
  },
  {
    id: 'details',
    pose: pose({
      x: 0, scale: 1.08, yaw: 0.5, explode: 0.72,
      camX: 3.35, camY: 1.75, camZ: 3.35, lookX: 0, lookY: 0.08,
    }),
  },
  {
    id: 'closing',
    pose: pose({
      x: 0.28, y: 0.02, scale: 0.58, yaw: 0.18,
      camX: 3.55, camY: 1.45, camZ: 3.85, lookX: 0.22, lookY: 0,
    }),
  },
];

/** Phones keep the same story with a shorter list and almost no lateral travel. */
export const MOBILE_BEATS: readonly Beat[] = [
  {
    id: 'hero',
    pose: pose({
      x: 0, y: -0.42, scale: 0.74, yaw: 0.4, turn: 0.08,
      camX: 2.8, camY: 1.35, camZ: 4.05, lookX: 0, lookY: -0.12,
    }),
  },
  {
    id: 'mid',
    pose: pose({
      x: 0.08, y: -0.2, scale: 0.92, yaw: 0.7, focus: 'body_shell',
      camX: 2.15, camY: 1.05, camZ: 2.85, lookX: 0.06, lookY: 0.02,
    }),
  },
  {
    id: 'explode',
    pose: pose({
      x: 0, y: -0.12, scale: 0.86, yaw: 0.36, explode: 0.58,
      camX: 3.15, camY: 1.7, camZ: 3.4, lookY: 0.02,
    }),
  },
  {
    id: 'closing',
    pose: pose({
      x: 0, y: 0.22, scale: 0.4, yaw: 0.16,
      camX: 3.4, camY: 1.4, camZ: 4.1, lookY: -0.08,
    }),
  },
];

export function mixPose(from: StagePose, to: StagePose, t: number): StagePose {
  const next = { ...from, focus: t >= 0.5 ? to.focus : from.focus };
  for (const key of NUMERIC_KEYS) next[key] = from[key] + (to[key] - from[key]) * t;
  return next;
}

export function sampleBeats(beats: readonly Beat[], index: number): StagePose {
  if (beats.length === 0) throw new Error('beats required');
  const clamped = Math.min(Math.max(index, 0), beats.length - 1);
  const from = Math.floor(clamped);
  const to = Math.min(beats.length - 1, from + 1);
  return mixPose(beats[from].pose, beats[to].pose, smoothstep(clamped - from));
}

/** Float index from scroll position. Anchors are section midpoints in document space. */
export function scrollIndex(midpoints: readonly number[], scrollY: number, viewport: number): number {
  if (midpoints.length === 0) return 0;
  const focus = scrollY + viewport * 0.42;
  if (focus <= midpoints[0]) return 0;
  const last = midpoints.length - 1;
  if (focus >= midpoints[last]) return last;
  for (let i = 0; i < last; i += 1) {
    const start = midpoints[i];
    const end = midpoints[i + 1];
    if (focus <= end) return i + (focus - start) / (end - start || 1);
  }
  return last;
}

/** Map a long anchor index onto a shorter beat list (phones). Same length stays 1:1. */
export function stageIndex(index: number, anchorCount: number, beatCount: number): number {
  if (anchorCount <= 1 || beatCount <= 1) return 0;
  const clamped = Math.min(Math.max(index, 0), anchorCount - 1);
  return (clamped / (anchorCount - 1)) * (beatCount - 1);
}

/** Reduced motion still follows the section, but it does not spin or explode. */
export function presentPose(poseValue: StagePose, reduced: boolean): StagePose {
  if (!reduced) return poseValue;
  return { ...poseValue, turn: 0, explode: 0 };
}
