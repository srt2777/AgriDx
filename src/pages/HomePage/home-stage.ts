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
    camX: 2.4,
    camY: 1.2,
    camZ: 4.05,
    lookX: 0,
    lookY: 0.04,
    lookZ: 0,
    explode: 0,
    turn: 0,
    focus: null,
    ...partial,
  };
}

/** Desktop keeps the model in the open lane: right of left-hand copy, left of right-hand copy. */
export const DESKTOP_BEATS: readonly Beat[] = [
  {
    id: 'hero',
    pose: pose({ x: 1.82, scale: 0.9, yaw: 0.46, turn: 0.04 }),
  },
  {
    id: 'capabilities',
    pose: pose({ x: 1.28, scale: 0.9, yaw: 0.36 }),
  },
  {
    id: 'painpoints',
    pose: pose({ x: 1.38, scale: 1.0, yaw: 0.62, focus: 'body_shell' }),
  },
  {
    id: 'knowledge',
    pose: pose({ x: -1.38, scale: 0.98, yaw: -0.42, focus: 'gps_antenna' }),
  },
  {
    id: 'techroute',
    pose: pose({ x: 1.36, scale: 1.0, yaw: 0.72, focus: 'wheel_fl' }),
  },
  {
    id: 'scenarios',
    pose: pose({ x: 1.34, scale: 0.98, yaw: 0.34, focus: 'battery_box' }),
  },
  {
    id: 'details',
    pose: pose({ x: 0.2, y: -0.06, scale: 0.9, yaw: 0.4, explode: 0.24 }),
  },
  {
    id: 'closing',
    pose: pose({ x: 1.2, y: 0.04, scale: 0.58, yaw: 0.22 }),
  },
];

/** Phones keep the same story in a lower dock, with almost no lateral travel. */
export const MOBILE_BEATS: readonly Beat[] = [
  {
    id: 'hero',
    pose: pose({
      x: 0.7, y: -0.62, scale: 0.62, yaw: 0.42, turn: 0.03,
      camX: 0.15, camY: 1.15, camZ: 4.35, lookX: 0, lookY: -0.2,
    }),
  },
  {
    id: 'mid',
    pose: pose({
      x: 0.55, y: -0.55, scale: 0.66, yaw: 0.48, focus: 'body_shell',
      camX: 0.1, camY: 1.1, camZ: 4.15, lookX: 0, lookY: -0.16,
    }),
  },
  {
    id: 'explode',
    pose: pose({
      x: 0, y: -0.68, scale: 0.68, yaw: 0.34, explode: 0.16,
      camX: 0.05, camY: 1.2, camZ: 4.4, lookY: -0.12,
    }),
  },
  {
    id: 'closing',
    pose: pose({
      x: 0, y: -0.28, scale: 0.4, yaw: 0.18,
      camX: 0.05, camY: 1.25, camZ: 4.5, lookY: -0.05,
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
