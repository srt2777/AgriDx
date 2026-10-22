import { useReducedMotion } from 'framer-motion';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';

export type OrbState = 'searching' | 'solving' | 'listening';

/** Named loading presence. Reduced motion keeps the orbs still and the label visible. */
export function ThinkingOrbs({ state, label }: { state: OrbState; label: string }) {
  const reduced = useReducedMotion() === true;
  if (!PREMIUM_MOTION_ENABLED) return null;
  return (
    <span className={`thinking-orbs is-${state}${reduced ? ' is-reduced' : ''}`} data-motion="thinking-orbs" data-orb={state} role="status">
      <span className="thinking-orbs-stage" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span className="thinking-orbs-label">{label}</span>
    </span>
  );
}

export function TwinQuery({ label }: { label: string }) {
  if (!PREMIUM_MOTION_ENABLED) return null;
  return (
    <div className="twin-query">
      <ThinkingOrbs state="searching" label={label} />
    </div>
  );
}
