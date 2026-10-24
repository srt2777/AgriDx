import type { CSSProperties, ReactNode } from 'react';
import { motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { UI_SPRING } from '@/lib/ui-motion';
import { LiquidGlass } from '@/components/ui/liquid-glass';
import { BorderBeam } from '@/components/motion/BorderBeam';

interface FloatingPanelProps {
  children: ReactNode;
  className: string;
  as?: 'div' | 'aside';
  id?: string;
  label?: string;
  style?: CSSProperties;
  glass?: boolean;
  beam?: boolean;
}

/** Exit can finish visually while the dismissed controls immediately stop taking input. */
export default function FloatingPanel({ children, className, as = 'div', id, label, style, glass = false, beam = false }: FloatingPanelProps) {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  const Panel = as === 'aside' ? motion.aside : motion.div;
  return <Panel
    id={id}
    className={className}
    aria-label={label}
    aria-hidden={present ? undefined : true}
    inert={!present}
    initial={reducedMotion ? false : { opacity: 0.65, scale: 0.94, y: -6 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98, y: -4, transition: { duration: 0.12 } }}
    transition={reducedMotion ? { duration: 0 } : UI_SPRING}
    style={{ transformOrigin: 'var(--ui-panel-origin, 100% 0%)', ...style }}
  >{glass ? <LiquidGlass lens displacementScale={24} className="floating-panel-glass" contentClassName="floating-panel-content">{children}</LiquidGlass> : children}{beam && <BorderBeam />}</Panel>;
}
