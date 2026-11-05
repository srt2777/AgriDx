import type { Observation } from './data';
/** Stable normalization for mixed-sign/extreme finite values. A range is not a health score. */
export function fraction(value: number, min: number, max: number) {
  if (max === min) return .5;
  const scale = Math.max(Math.abs(min), Math.abs(max), 1);
  return Math.max(0, Math.min(1, (value / scale - min / scale) / (max / scale - min / scale)));
}
export function histogram(points: readonly Observation[], bins = 12) {
  if (!points.length) return [];
  const min = Math.min(...points.map(p => p.value)), max = Math.max(...points.map(p => p.value));
  const count = min === max ? 1 : Math.max(1, Math.min(30, Math.floor(bins)));
  const result = Array.from({length: count}, (_, i) => ({ low: min * (1 - i / count) + max * (i / count), high: min * (1 - (i + 1) / count) + max * ((i + 1) / count), count: 0 }));
  for (const p of points) result[Math.min(count - 1, Math.floor(fraction(p.value,min,max) * count))].count++;
  return result;
}
/** Uniform time cells retain missing intervals; each value is a mean of actual observations. */
export function timeCells(points: readonly Observation[], from: number, to: number, count = 48) {
  const cells = Array.from({length: count}, (_, i) => ({ at: from + (to - from) * i / count, value: null as number | null, count: 0 }));
  for (const p of points) {
    if (p.at < from || p.at > to) continue;
    const cell = cells[Math.min(count - 1, Math.floor((to === from ? .5 : (p.at - from) / (to - from)) * count))];
    cell.count++; cell.value = (cell.value ?? 0) * ((cell.count - 1) / cell.count) + p.value / cell.count;
  }
  return cells;
}
export function timelineBounds(rows: readonly { points: readonly Observation[] }[]) {
  const populated = rows.filter(r => r.points.length);
  return populated.length ? { from: Math.min(...populated.map(r => r.points[0].at)), to: Math.max(...populated.map(r => r.points.at(-1)!.at)) } : null;
}

/** A full comparison remains editable: selecting a fifth channel replaces the oldest. */
export function toggleComparison(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.length > 1 ? ids.filter(value => value !== id) : [...ids];
  return [...ids.slice(-3), id];
}
/** Shares are only of nonnegative, dimensionally identical readings, never mixed units. */
export function comparisonShares(rows: readonly { unit: string; value: number }[]) {
  if (rows.length < 2 || !rows[0].unit || rows.some(r => r.unit !== rows[0].unit || !Number.isFinite(r.value) || r.value < 0)) return null;
  const scale = Math.max(...rows.map(r => r.value));
  if (scale === 0) return null;
  const total = rows.reduce((sum, r) => sum + r.value / scale, 0);
  return rows.map(r => r.value / scale / total);
}
