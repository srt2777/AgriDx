import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';

/** Soft riding glow along a selected card or chip. The spin stops when motion is reduced. */
export function BorderBeam() {
  if (!PREMIUM_MOTION_ENABLED) return null;
  return (
    <span className="border-beam" data-motion="border-beam" aria-hidden="true">
      <span className="border-beam-spin" />
    </span>
  );
}
