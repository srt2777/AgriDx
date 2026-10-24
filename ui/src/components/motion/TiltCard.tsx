import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';

/** Subtle cursor tilt and glare. Touch and reduced motion stay flat. */
export function TiltCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion() === true;
  const [fine, setFine] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const rx = useSpring(0, { stiffness: 260, damping: 24, mass: 0.6 });
  const ry = useSpring(0, { stiffness: 260, damping: 24, mass: 0.6 });
  const glare = useSpring(0, { stiffness: 240, damping: 26 });
  const gx = useMotionValue(50);
  const gy = useMotionValue(35);
  const glareBackground = useMotionTemplate`radial-gradient(110px circle at ${gx}% ${gy}%, rgb(255 255 255 / 0.72), transparent 62%)`;

  useEffect(() => {
    const media = window.matchMedia('(pointer: fine)');
    const apply = () => setFine(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  const flat = reduced || !fine || !PREMIUM_MOTION_ENABLED;
  if (!PREMIUM_MOTION_ENABLED) return <>{children}</>;

  function move(event: PointerEvent<HTMLDivElement>) {
    if (flat || event.pointerType !== 'mouse') return;
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    ry.set((px - 0.5) * 9);
    rx.set((0.5 - py) * 7);
    gx.set(px * 100);
    gy.set(py * 100);
    glare.set(1);
  }

  function leave() {
    rx.set(0);
    ry.set(0);
    glare.set(0);
  }

  return (
    <motion.div
      ref={ref}
      className={`tilt-card${flat ? ' is-flat' : ''} ${className}`}
      data-motion="tilt-card"
      style={flat ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 720 }}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      {children}
      {!flat && <motion.span className="tilt-glare" style={{ opacity: glare, background: glareBackground }} aria-hidden="true" />}
    </motion.div>
  );
}
