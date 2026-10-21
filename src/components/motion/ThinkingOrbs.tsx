import { useReducedMotion } from 'framer-motion';

export type OrbState = 'searching' | 'solving' | 'listening';

/** Named loading presence. Reduced motion keeps the orbs still and the label visible. */
export function ThinkingOrbs({ state, label }: { state: OrbState; label: string }) {
  const reduced = useReducedMotion() === true;
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
  return (
    <div className="twin-query">
      <ThinkingOrbs state="searching" label={label} />
    </div>
  );
}
