import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';

/** Spring-in glass drawer. The scrim does not take clicks, so the twin stage stays usable. */
export function SpringDrawer({
  open,
  motionKey = 'drawer',
  className = '',
  labelledBy,
  children,
}: {
  open: boolean;
  motionKey?: string;
  className?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() === true;
  if (!PREMIUM_MOTION_ENABLED) {
    if (!open) return null;
    return <aside className={className} aria-labelledby={labelledBy}>{children}</aside>;
  }
  const fade = reduced ? { duration: 0 } : { duration: 0.22 };
  const spring = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 360, damping: 32, mass: 0.82 };
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            className="spring-drawer-scrim"
            aria-hidden="true"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.aside
            key={motionKey}
            className={`spring-drawer ${className}`}
            data-motion="spring-drawer"
            aria-labelledby={labelledBy}
            initial={reduced ? false : { x: -36, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduced ? { opacity: 1 } : { x: -28, opacity: 0 }}
            transition={spring}
          >
            {children}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
