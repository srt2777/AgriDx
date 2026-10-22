import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BorderBeam } from '@/components/motion/BorderBeam';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';

/** One glass panel. Height follows the step; content cross-fades through a short blur. */
export function MorphingPanel({ stepKey, className = '', beam = false, children }: { stepKey: string; className?: string; beam?: boolean; children: ReactNode }) {
  const reduced = useReducedMotion() === true;
  if (!PREMIUM_MOTION_ENABLED) return <>{children}</>;
  return (
    <motion.div
      layout={reduced ? false : true}
      className={`morph-panel ${className}`}
      data-motion="morph"
      transition={reduced ? { duration: 0 } : { layout: { type: 'spring', stiffness: 280, damping: 32, mass: 0.85 } }}
    >
      {beam && <BorderBeam />}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={stepKey}
          className="morph-panel-view"
          initial={reduced ? false : { opacity: 0, filter: 'blur(8px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={reduced ? { opacity: 1 } : { opacity: 0, filter: 'blur(8px)' }}
          transition={reduced ? { duration: 0 } : { duration: 0.26 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
