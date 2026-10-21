import { useEffect, useState } from 'react';
import { countFrame } from '@/lib/delight';
import { MOTION } from '@/lib/motion-tokens';

/** Counts up to a stat. Reduced motion shows the final number at once. */
export function StatTicker({ value, reduced }: { value: number | undefined; reduced: boolean }) {
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
  if (shown === null) return '—';
  return <span className="nv-ticker">{Math.round(shown).toLocaleString()}</span>;
}
