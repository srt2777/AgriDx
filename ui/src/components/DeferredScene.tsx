import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';

/** Let the page paint and remain navigable before importing or initializing WebGL. */
export default function DeferredScene({ children, fallback, priority = false }: { children: ReactNode; fallback: ReactNode; priority?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!('IntersectionObserver' in window));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || !container.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '80px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    if (ready || (!visible && !priority)) return;
    let cancelled = false, firstFrame = 0, secondFrame = 0, idle = 0, timer = 0;
    const open = () => { if (!cancelled) setReady(true); };
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (priority) open();
        else if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(open, { timeout: 1200 });
        else timer = window.setTimeout(open, 150);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (idle) window.cancelIdleCallback(idle);
      window.clearTimeout(timer);
    };
  }, [ready, visible, priority]);

  return <div ref={container} className="h-full w-full" data-scene-ready={ready}>
    {ready ? <Suspense fallback={fallback}>{children}</Suspense> : fallback}
  </div>;
}
