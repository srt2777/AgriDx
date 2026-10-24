import { motion, useReducedMotion } from 'framer-motion';
import { UI_SPRING } from '@/lib/ui-motion';
import './liquid-selection.css';

/** A single moving fill; labels and hit areas retain their normal layout. */
export function LiquidSelection({ className = '', layoutId = 'selection' }: { className?: string; layoutId?: string }) {
  const reducedMotion = useReducedMotion();
  return <motion.span
    className={`fluid-selection ${className}`}
    layoutId={layoutId}
    initial={false}
    transition={reducedMotion ? { duration: 0 } : UI_SPRING}
    aria-hidden="true"
  ><span className="fluid-selection-surface" /></motion.span>;
}
