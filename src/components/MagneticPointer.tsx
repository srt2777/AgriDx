import { useEffect, useRef } from 'react';

/** Nudges the nearest `.magnetic` control and a click-through glow. Fine pointers only. */
export default function MagneticPointer({ active }: { active: boolean }) {
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !window.matchMedia?.('(pointer: fine)').matches) return;
    const move = (event: PointerEvent) => {
      const halo = glow.current;
      if (halo) {
        halo.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
        halo.style.opacity = '1';
      }
      const nodes = document.querySelectorAll<HTMLElement>('.magnetic');
      nodes.forEach((node) => { node.style.transform = ''; });
      let best: HTMLElement | null = null;
      let bestDx = 0;
      let bestDy = 0;
      let bestDist = 78;
      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return;
        const dx = event.clientX - (rect.left + rect.width / 2);
        const dy = event.clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          best = node;
          bestDist = dist;
          bestDx = dx;
          bestDy = dy;
        }
      });
      if (best) {
        const pulled = best as HTMLElement;
        pulled.style.transform = `translate(${(bestDx * 0.22).toFixed(1)}px, ${(bestDy * 0.22).toFixed(1)}px)`;
      }
    };
    const clear = () => {
      document.querySelectorAll<HTMLElement>('.magnetic').forEach((node) => { node.style.transform = ''; });
      if (glow.current) glow.current.style.opacity = '0';
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerleave', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerleave', clear);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [active]);
  if (!active) return null;
  return <div ref={glow} className="pointer-glow" aria-hidden="true" />;
}
