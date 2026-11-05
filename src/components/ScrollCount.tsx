import { useEffect, useRef, useState } from 'react';
import { SCROLL_COUNT_MS, scrollCountFrame } from '@/lib/scroll-count';

/** Counts from 0 once when the figure enters view. The final width is reserved. */
export function ScrollCount({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const finalText = Math.round(value).toLocaleString();
  const [text, setText] = useState(() => (prefersReducedMotion() ? finalText : '0'));

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (prefersReducedMotion()) {
      setText(finalText);
      return undefined;
    }
    setText('0');
    let frame = 0;
    let started = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || started) return;
      started = true;
      observer.disconnect();
      // Start the clock on a painted frame so a busy load cannot skip the count.
      frame = requestAnimationFrame(first => {
        const tick = (now: number) => {
          const shown = scrollCountFrame(value, now - first, false);
          setText(Math.round(shown).toLocaleString());
          if (now - first < SCROLL_COUNT_MS) frame = requestAnimationFrame(tick);
          else setText(finalText);
        };
        tick(first);
      });
    }, { threshold: 0.2 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [finalText, value]);

  return <span ref={ref} className="scroll-count" style={{ minWidth: `${finalText.length}ch` }}>{text}</span>;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
