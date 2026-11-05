import { useEffect, useState, type RefObject } from 'react';

type Box = { x: number; y: number; w: number; h: number };

function sameBox(current: Box, next: Box) {
  return current.x === next.x && current.y === next.y && current.w === next.w && current.h === next.h;
}

/**
 * One indicator behind the active item. Position uses translate3d; size uses width/height.
 * Measurement runs after paint so a later active item can slide from the previous box.
 * Labels stay in normal flow.
 */
export function GlidingSelection({
  rootRef,
  activeSelector,
  className = 'gliding-selection',
  watch,
}: {
  rootRef: RefObject<HTMLElement | null>;
  activeSelector: string;
  className?: string;
  watch?: unknown;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const measure = () => {
      const active = root.querySelector<HTMLElement>(activeSelector);
      if (!active || active.offsetWidth < 1 || active.offsetHeight < 1) {
        setBox(current => (current === null ? current : null));
        return;
      }
      const next = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
      setBox(current => (current && sameBox(current, next) ? current : next));
    };
    measure();
    const frame = requestAnimationFrame(() => setMotion(true));
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [activeSelector, rootRef, watch]);

  if (!box) return null;
  return <span
    className={`${className}${motion ? '' : ' is-instant'}`}
    style={{ width: box.w, height: box.h, transform: `translate3d(${box.x}px, ${box.y}px, 0)` }}
    aria-hidden="true"
  />;
}
