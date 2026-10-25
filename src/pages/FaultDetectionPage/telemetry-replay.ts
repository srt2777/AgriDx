import type { TelemetryPoint } from '../../../shared/telemetry';

/** A point already received by useTelemetry; this adapter never creates samples. */
export interface ReplayPoint {
  point: TelemetryPoint;
  index: number;
}

export interface ReplayTimeline {
  points: ReplayPoint[];
  from: number | null;
  to: number | null;
}

export interface ReplayCursor {
  index: number;
  elapsedMs: number;
  mode: 'received-history' | 'paused-view';
}

/** Sort one channel's received history and drop exact duplicate samples. */
export function buildReplayTimeline(points: readonly TelemetryPoint[], channelId: string): ReplayTimeline {
  const sorted = points.filter(point => point.channelId === channelId && Number.isFinite(point.at)
    && Number.isFinite(point.elapsedMs) && Number.isFinite(point.value))
    .slice().sort((left, right) => left.at - right.at || left.elapsedMs - right.elapsedMs);
  const unique: TelemetryPoint[] = [];
  const seen = new Set<string>();
  for (const point of sorted) {
    const key = `${point.at}:${point.elapsedMs}:${point.value}`;
    if (seen.has(key)) continue;
    seen.add(key); unique.push(point);
  }
  return { points: unique.map((point, index) => ({ point, index })), from: unique[0]?.at ?? null, to: unique.at(-1)?.at ?? null };
}

/** Move only within the received timeline. A missing/negative cursor returns no point. */
export function cursorAt(timeline: ReplayTimeline, elapsedMs: number, mode: ReplayCursor['mode'] = 'paused-view'): ReplayCursor {
  if (!timeline.points.length || !Number.isFinite(elapsedMs)) return { index: -1, elapsedMs: 0, mode };
  const bounded = Math.max(0, elapsedMs);
  let index = -1;
  for (const item of timeline.points) {
    if (item.point.elapsedMs > bounded) break;
    index = item.index;
  }
  if (index < 0) index = 0;
  return { index, elapsedMs: timeline.points[index].point.elapsedMs, mode };
}

/** Return the prefix visible at a cursor; no interpolation or future values are added. */
export function pointsThrough(timeline: ReplayTimeline, cursor: ReplayCursor): ReplayPoint[] {
  if (cursor.index < 0) return [];
  return timeline.points.slice(0, Math.min(cursor.index + 1, timeline.points.length));
}

export function resetForRun(): ReplayCursor { return { index: -1, elapsedMs: 0, mode: 'received-history' }; }
