import React, { useEffect, useState } from 'react';
import { countFrame } from '../lib/delight';
import { MOTION } from '../lib/motion-tokens';

/** Counts up to a stat. Reduced motion shows the final number at once. */
export function StatTicker({ value, reduced, precision = 0, locale }: { value: number | undefined; reduced: boolean; precision?: number; locale?: string }) {
  const [shown, setShown] = useState<number | null>(() => (value === undefined ? null : reduced ? value : 0));
  useEffect(() => {
    if (value === undefined) {
      setShown(null);
      return undefined;
    }
    if (reduced) {
      setShown(value);
      return undefined;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      setShown(countFrame(value, now - start, MOTION.ms.count, false));
      if (now - start < MOTION.ms.count) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, value]);
  // Live sample displays opt out of interpolation, including the render before an effect runs.
  const current = reduced ? value : shown;
  if (current === null || current === undefined) return '—';
  const digits = Number.isFinite(precision) ? Math.min(6, Math.max(0, Math.trunc(precision))) : 0;
  return <span className="nv-ticker">{(digits ? current : Math.round(current)).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>;
}
