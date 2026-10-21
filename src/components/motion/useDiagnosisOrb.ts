import { useEffect, useState } from 'react';
import type { OrbState } from '@/components/motion/ThinkingOrbs';

/** Searching while a diagnosis request starts, then solving. Resets when it ends. */
export function useDiagnosisOrb(active: boolean): OrbState {
  const [state, setState] = useState<OrbState>('searching');
  useEffect(() => {
    if (!active) {
      setState('searching');
      return;
    }
    setState('searching');
    const timer = window.setTimeout(() => setState('solving'), 1100);
    return () => window.clearTimeout(timer);
  }, [active]);
  return state;
}
