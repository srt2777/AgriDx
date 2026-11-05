/** One-shot count-up for old-version figures. 1.3s sits inside the 1.2–1.4s range. */
export const SCROLL_COUNT_MS = 1300;

/** Ease-out cubic. Reduced motion and a finished clock both return the final value. */
export function scrollCountFrame(goal: number, elapsedMs: number, reduced: boolean): number {
  if (!Number.isFinite(goal)) return 0;
  if (reduced || !(SCROLL_COUNT_MS > 0)) return goal;
  const t = Math.min(1, Math.max(0, elapsedMs / SCROLL_COUNT_MS));
  const eased = 1 - (1 - t) ** 3;
  return goal * eased;
}
