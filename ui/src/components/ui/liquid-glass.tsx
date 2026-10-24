import { lazy, Suspense, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useGlassMode } from '@/hooks/useGlassMode';
import type { GlassInteraction, GlassOpticsHandle } from '@/lib/glass-optics';
import './liquid-glass.css';

interface LiquidGlassProps extends HTMLAttributes<HTMLDivElement> {
  contentClassName?: string;
  variant?: 'regular' | 'clear';
  lens?: boolean;
  displacementScale?: number;
}

const GlassLens = lazy(() => import('./glass-lens'));

/** Keep content in normal flow; the native optical filter only samples its backdrop. */
export function LiquidGlass({ children, className = '', contentClassName = '', variant = 'regular', lens = false, displacementScale = 28, ...props }: LiquidGlassProps) {
  const ref = useRef<HTMLDivElement>(null);
  const optics = useRef<GlassOpticsHandle>(null);
  const interaction = useRef<GlassInteraction>({ x: 0, y: 0, active: false, pressed: false });
  const mode = useGlassMode();
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [size, setSize] = useState({ width: 0, height: 0, radius: 22, blur: 12 });
  const refract = lens && mode === 'refract' && visible;

  useEffect(() => {
    const element = ref.current;
    if (!element || !lens || mode !== 'refract' || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '80px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [lens, mode]);

  useEffect(() => {
    const element = ref.current;
    if (!element || !refract) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const width = element.clientWidth, height = element.clientHeight;
      const computed = getComputedStyle(element);
      const next = {
        width: Math.round(width), height: Math.round(height),
        radius: Math.min(parseFloat(computed.borderRadius) || 22, width / 2, height / 2),
        blur: parseFloat(computed.getPropertyValue('--lg-blur')) || 12,
      };
      setSize(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [refract]);

  useEffect(() => {
    const element = ref.current;
    if (!element || mode === 'solid' || reducedMotion) return;
    let frame = 0;
    let point: Pick<PointerEvent, 'clientX' | 'clientY' | 'target'> | null = null;
    let pressedControl: HTMLElement | null = null;
    const touched = new Set<HTMLElement>();
    const ripples = new Set<HTMLElement>();
    const ripple = (control: HTMLElement, x: number, y: number) => {
      if (element.closest('[data-ui-version="new"]')) return;
      for (const old of control.querySelectorAll('.material-ripple')) { ripples.delete(old as HTMLElement); old.remove(); }
      const rect = control.getBoundingClientRect();
      const node = document.createElement('span');
      node.className = 'material-ripple'; node.setAttribute('aria-hidden', 'true');
      node.style.setProperty('--ripple-x', `${x - rect.left}px`);
      node.style.setProperty('--ripple-y', `${y - rect.top}px`);
      node.style.setProperty('--ripple-size', `${Math.hypot(rect.width, rect.height) * 2}px`);
      node.addEventListener('animationend', () => { node.remove(); ripples.delete(node); }, { once: true });
      ripples.add(node); control.appendChild(node);
    };
    const updateOptics = (next: Partial<GlassInteraction>) => {
      Object.assign(interaction.current, next);
      optics.current?.update(interaction.current);
    };
    const clearPress = () => {
      pressedControl?.removeAttribute('data-glass-pressed');
      pressedControl = null;
      element.removeAttribute('data-glass-pressed');
      updateOptics({ pressed: false });
    };
    const clear = () => {
      clearPress();
      cancelAnimationFrame(frame);
      frame = 0;
      point = null;
      element.removeAttribute('data-glass-active');
      for (const target of touched) {
        for (const name of ['--mx', '--my', '--lg-light-angle', '--lg-press-x', '--lg-press-y']) target.style.removeProperty(name);
      }
      touched.clear();
      updateOptics({ x: 0, y: 0, active: false, pressed: false });
    };
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (!point) return;
      const control = pressedControl ?? findControl(point.target);
      for (const target of [element, control]) {
        if (!target || !element.contains(target)) continue;
        const rect = target.getBoundingClientRect();
        const x = point.clientX - rect.left, y = point.clientY - rect.top;
        target.style.setProperty('--mx', `${x.toFixed(1)}px`);
        target.style.setProperty('--my', `${y.toFixed(1)}px`);
        target.style.setProperty('--lg-light-angle', `${Math.atan2(x - rect.width / 2, -(y - rect.height / 2)) * 180 / Math.PI}deg`);
        if (target === element) updateOptics({ x: (x / rect.width - .5) * 2, y: (y / rect.height - .5) * 2, active: true, pressed: !!pressedControl });
        if (target === pressedControl) {
          target.style.setProperty('--lg-press-x', `${Math.max(-1.5, Math.min(1.5, (x / rect.width - .5) * 3))}px`);
          target.style.setProperty('--lg-press-y', `${Math.max(-1, Math.min(1, (y / rect.height - .5) * 2))}px`);
        }
        touched.add(target);
      }
      element.setAttribute('data-glass-active', 'true');
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && !pressedControl) return;
      point = event;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const findControl = (target: EventTarget | null) => {
      const control = target instanceof Element ? target.closest<HTMLElement>('button, a') : null;
      if (!control || !element.contains(control) || control.closest('.agri-liquid-glass') !== element || (control instanceof HTMLButtonElement && control.disabled) || control.getAttribute('aria-disabled') === 'true') return null;
      return control;
    };
    const press = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      const control = findControl(event.target);
      if (!control) return;
      clearPress();
      pressedControl = control;
      control.setAttribute('data-glass-pressed', 'true');
      element.setAttribute('data-glass-pressed', 'true');
      point = event;
      ripple(control, event.clientX, event.clientY);
      flush();
    };
    const release = (event: PointerEvent) => {
      clearPress();
      if (event.pointerType === 'touch') clear();
    };
    const visibility = () => { if (document.hidden) clear(); };
    const focusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) clear();
      else if (pressedControl && !pressedControl.contains(event.relatedTarget)) clearPress();
    };
    const keyPress = (event: KeyboardEvent) => {
      if (event.repeat || !['Enter', ' '].includes(event.key)) return;
      const control = findControl(event.target);
      if (!control || (control.tagName === 'A' && event.key === ' ')) return;
      clearPress();
      pressedControl = control;
      control.setAttribute('data-glass-pressed', 'true');
      element.setAttribute('data-glass-pressed', 'true');
      const rect = control.getBoundingClientRect();
      point = { target: control, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      ripple(control, point.clientX, point.clientY);
      flush();
    };
    element.addEventListener('pointermove', move, { passive: true });
    element.addEventListener('pointerdown', press, { passive: true });
    element.addEventListener('pointerleave', clear);
    element.addEventListener('pointercancel', clear);
    element.addEventListener('keydown', keyPress);
    element.addEventListener('focusout', focusOut);
    window.addEventListener('pointerup', release);
    window.addEventListener('keyup', clearPress);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('pointerleave', clear);
      element.removeEventListener('pointercancel', clear);
      element.removeEventListener('keydown', keyPress);
      element.removeEventListener('focusout', focusOut);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('keyup', clearPress);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      for (const node of ripples) node.remove();
      ripples.clear();
      clear();
    };
  }, [lens, mode, reducedMotion]);

  return <div {...props} ref={ref} className={`liquid-glass agri-liquid-glass lg-${variant} ${className}`} data-glass-mode={mode} data-glass-design="material-you">
    {refract && size.width > 0 && size.height > 0 ? <div className="liquid-glass-effect agri-glass-lens" aria-hidden="true">
      <Suspense fallback={<div className="agri-glass-frost" />}><GlassLens
        key={`${size.width}x${size.height}`}
        {...size} displacementScale={displacementScale} interaction={interaction} surface={ref} ref={optics}
      /></Suspense>
    </div> : <div className="liquid-glass-effect agri-glass-frost" aria-hidden="true" />}
    <div className="liquid-glass-tint" aria-hidden="true" />
    <div className="liquid-glass-shine" aria-hidden="true" />
    <div className={`liquid-glass-content ${contentClassName}`}>{children}</div>
  </div>;
}
