import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Nudges the nearest `.magnetic` control and a click-through glow. Fine pointers only. */
export default function MagneticPointer({ active }: { active: boolean }) {
  const glow = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = document.querySelector('.expo-world-canvas');
    setHost(node instanceof HTMLElement ? node : null);
  }, [active]);
  useEffect(() => {
    if (!active || !window.matchMedia?.('(pointer: fine)').matches) return;
    const move = (event: PointerEvent) => {
      const halo = glow.current;
      if (halo) {
        const stage = halo.offsetParent instanceof HTMLElement ? halo.offsetParent.getBoundingClientRect() : null;
        const x = stage ? event.clientX - stage.left : event.clientX;
        const y = stage ? event.clientY - stage.top : event.clientY;
        halo.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        halo.style.opacity = stage && (x < 0 || y < 0 || x > stage.width || y > stage.height) ? '0' : '1';
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
  const glowNode = <div ref={glow} className="pointer-glow" aria-hidden="true" />;
  return host ? createPortal(glowNode, host) : glowNode;
}
