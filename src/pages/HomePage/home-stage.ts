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
    camY: 1.55,
    camZ: 4.15,
    lookX: 0,
    lookY: 0.05,
    lookZ: 0,
    explode: 0,
    turn: 0,
    focus: null,
    ...partial,
  };
}

/** Projected box fills this fraction of the open lane, clamped so it cannot cross the card. */
export const LANE_AREA_FILL = 0.6;

export type ScreenRect = { x: number; y: number; width: number; height: number };

function areaOf(rect: ScreenRect): number {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

/** Largest region of the canvas that does not intersect the text card. */
export function freeLane(canvas: ScreenRect, card: ScreenRect | null, gap = 24): ScreenRect {
  const padded = {
    x: canvas.x + gap,
    y: canvas.y + gap,
    width: Math.max(0, canvas.width - gap * 2),
    height: Math.max(0, canvas.height - gap * 2),
  };
  if (!card) return padded;
  const right = card.x + card.width;
  const bottom = card.y + card.height;
  const candidates = [
    { x: right + gap, y: padded.y, width: canvas.x + canvas.width - gap - (right + gap), height: padded.height },
    { x: padded.x, y: padded.y, width: card.x - gap - padded.x, height: padded.height },
    { x: padded.x, y: bottom + gap, width: padded.width, height: canvas.y + canvas.height - gap - (bottom + gap) },
    { x: padded.x, y: padded.y, width: padded.width, height: card.y - gap - padded.y },
  ].filter(rect => rect.width >= 64 && rect.height >= 64);
  candidates.sort((a, b) => areaOf(b) - areaOf(a));
  return candidates[0] ?? padded;
}

/**
 * Scale the projected box toward `fill` of the lane's area, then keep the whole box inside the lane.
 * Translation recenters the box after scaling about its own center.
 */
export function fitProjectedBox(box: ScreenRect, lane: ScreenRect, fill = LANE_AREA_FILL): { dx: number; dy: number; scale: number } {
  const boxW = Math.max(box.width, 1);
  const boxH = Math.max(box.height, 1);
  const aspect = boxW / boxH;
  const targetArea = Math.min(0.65, Math.max(0.55, fill)) * Math.max(areaOf(lane), 1);
  let width = Math.sqrt(targetArea * aspect);
  let height = width / aspect;
  const clamp = Math.min(1, lane.width / Math.max(width, 1), lane.height / Math.max(height, 1));
  width *= clamp;
  height *= clamp;
  return {
    dx: lane.x + lane.width / 2 - (box.x + box.width / 2),
    dy: lane.y + lane.height / 2 - (box.y + box.height / 2),
    scale: Math.min(6, Math.max(0.15, width / boxW)),
  };
}

/** Later beats share the hero scale. Screen fitting places each one in the open lane. */
export const DESKTOP_BEATS: readonly Beat[] = [
  {
    id: 'hero',
    pose: pose({ x: 0, scale: 1, yaw: -0.95, turn: 0.03, camY: 1.55, camZ: 4.15, lookY: 0.05 }),
  },
  {
    id: 'capabilities',
    pose: pose({ x: 0, scale: 1, yaw: -0.42 }),
  },
  {
    id: 'painpoints',
    pose: pose({ x: 0, scale: 1, yaw: -0.7, focus: 'body_shell' }),
  },
  {
    id: 'knowledge',
    pose: pose({ x: 0, scale: 1, yaw: 0.5, focus: 'gps_antenna' }),
  },
  {
    id: 'techroute',
    pose: pose({ x: 0, scale: 1, yaw: -0.62, focus: 'wheel_fl' }),
  },
  {
    id: 'scenarios',
    pose: pose({ x: 0, scale: 1, yaw: -0.38, focus: 'battery_box' }),
  },
  {
    id: 'details',
    pose: pose({ x: 0, scale: 1, yaw: -0.48, explode: 0.24 }),
  },
  {
    id: 'closing',
    pose: pose({ x: 0, scale: 0.92, yaw: -0.32 }),
  },
];

/** Phones use the same scale story inside the lower dock. */
export const MOBILE_BEATS: readonly Beat[] = [
  {
    id: 'hero',
    pose: pose({ x: 0, scale: 1, yaw: -0.48, turn: 0.03, camY: 1.28, camZ: 4.2, lookY: 0 }),
  },
  {
    id: 'mid',
    pose: pose({ x: 0, scale: 1, yaw: -0.62, focus: 'body_shell', camY: 1.28, camZ: 4.2, lookY: 0 }),
  },
  {
    id: 'explode',
    pose: pose({ x: 0, scale: 1, yaw: -0.4, explode: 0.16, camY: 1.28, camZ: 4.2, lookY: 0 }),
  },
  {
    id: 'closing',
    pose: pose({ x: 0, scale: 0.92, yaw: -0.3, camY: 1.28, camZ: 4.2, lookY: 0 }),
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
