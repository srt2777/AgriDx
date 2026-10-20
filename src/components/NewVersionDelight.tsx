import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useLang } from '@/hooks/useLang';
import {
  PRESS_SELECTOR,
  TILT_SELECTOR,
  TOOLTIP_DELAY_MS,
  isTypingTarget,
  openShortcuts,
  pointerTilt,
  scrollProgress,
  shortcutRows,
  shortcutToggleKey,
  tiltAllowed,
  tooltipPlacement,
} from '@/lib/delight';
import './delight.css';

type TipState = { text: string; rect: DOMRect };

function finePointer(): boolean {
  return window.matchMedia('(pointer: fine)').matches;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Cursor tilt, press origin, reading progress, glass tooltips, and the ? shortcut list. */
export function NewVersionDelight() {
  const lang = useLang();
  const location = useLocation();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const tipNode = useRef<HTMLDivElement>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [tip, setTip] = useState<TipState | null>(null);
  const rows = shortcutRows(lang === 'zh' ? 'zh' : 'en');

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scroller = document.scrollingElement;
      if (!scroller || !bar.current) return;
      const value = scrollProgress(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
      bar.current.style.transform = `scaleX(${value})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [location.pathname]);

  useEffect(() => {
    const fineMedia = window.matchMedia('(pointer: fine)');
    const reduceMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    let tilted: HTMLElement | null = null;
    let frame = 0;
    let pending: PointerEvent | null = null;
    const clearTilt = () => {
      if (!tilted) return;
      tilted.style.removeProperty('--nv-rx');
      tilted.style.removeProperty('--nv-ry');
      tilted.classList.remove('is-tilting');
      tilted = null;
    };
    const apply = () => {
      frame = 0;
      const event = pending;
      pending = null;
      if (!event || !tiltAllowed({ fine: finePointer(), reduced: reducedMotion() })) {
        clearTilt();
        return;
      }
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>(TILT_SELECTOR) : null;
      if (tilted && tilted !== node) clearTilt();
      if (!node) return;
      const tilt = pointerTilt(node.getBoundingClientRect(), event.clientX, event.clientY);
      if (!tilt) {
        if (tilted === node) clearTilt();
        return;
      }
      tilted = node;
      node.classList.add('is-tilting');
      node.style.setProperty('--nv-rx', `${tilt.x}deg`);
      node.style.setProperty('--nv-ry', `${tilt.y}deg`);
    };
    const onMove = (event: PointerEvent) => {
      if (!tiltAllowed({ fine: finePointer(), reduced: reducedMotion() })) return;
      pending = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onPress = (event: PointerEvent) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>(PRESS_SELECTOR) : null;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      node.style.setProperty('--nv-press-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
      node.style.setProperty('--nv-press-y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
    };
    fineMedia.addEventListener('change', clearTilt);
    reduceMedia.addEventListener('change', clearTilt);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onPress, { passive: true });
    window.addEventListener('blur', clearTilt);
    return () => {
      fineMedia.removeEventListener('change', clearTilt);
      reduceMedia.removeEventListener('change', clearTilt);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onPress);
      window.removeEventListener('blur', clearTilt);
      cancelAnimationFrame(frame);
      clearTilt();
    };
  }, []);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    let savedTitle: string | null = null;
    let addedLabel = false;
    const restore = () => {
      if (!current) return;
      if (savedTitle !== null) current.setAttribute('title', savedTitle);
      if (addedLabel) current.removeAttribute('aria-label');
      current = null;
      savedTitle = null;
      addedLabel = false;
    };
    const hide = () => {
      window.clearTimeout(timer);
      restore();
      setTip(null);
    };
    const arm = (node: HTMLElement) => {
      if (current === node) return;
      if (!node.closest('[data-ui-version="new"]')) return;
      const text = node.getAttribute('data-tip') || node.getAttribute('title');
      if (!text) return;
      window.clearTimeout(timer);
      restore();
      current = node;
      savedTitle = node.getAttribute('title');
      if (savedTitle !== null) node.removeAttribute('title');
      if (!node.hasAttribute('aria-label') && !node.hasAttribute('aria-labelledby')) {
        node.setAttribute('aria-label', text);
        addedLabel = true;
      }
      timer = window.setTimeout(() => {
        if (current !== node) return;
        setTip({ text, rect: node.getBoundingClientRect() });
      }, TOOLTIP_DELAY_MS);
    };
    const onOver = (event: PointerEvent) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[title], [data-tip]') : null;
      if (!node) return;
      arm(node);
    };
    const onOut = (event: PointerEvent) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[title], [data-tip]') : null;
      if (!node || node !== current) return;
      if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
      hide();
    };
    const onFocus = (event: FocusEvent) => {
      const node = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[title], [data-tip]') : null;
      if (node) arm(node);
    };
    const onBlur = (event: FocusEvent) => {
      const node = event.target instanceof Element ? event.target.closest<HTMLElement>('[title], [data-tip]') : null;
      if (node && node === current) hide();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer);
      restore();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    const node = tipNode.current;
    if (!tip || !node) return;
    const placed = tooltipPlacement(tip.rect, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    node.style.left = `${placed.left}px`;
    node.style.top = `${placed.top}px`;
    node.style.setProperty('--nv-tip-arrow', `${placed.arrow}px`);
    node.classList.toggle('is-above', placed.above);
    node.classList.toggle('is-below', !placed.above);
  }, [tip]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && shortcuts) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setShortcuts(false);
        return;
      }
      if (!shortcutToggleKey(event) || isTypingTarget(event.target)) return;
      event.preventDefault();
      setShortcuts((open) => !open);
    };
    const open = () => setShortcuts(true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('agridx-shortcuts-open', open);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('agridx-shortcuts-open', open);
    };
  }, [shortcuts]);

  useEffect(() => {
    if (!shortcuts) return;
    const previously = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => previously?.focus();
  }, [shortcuts]);

  return (
    <>
      <div className="nv-progress" aria-hidden="true"><span ref={bar} /></div>
      {tip && createPortal(
        <div ref={tipNode} className="nv-tip" role="tooltip">{tip.text}</div>,
        document.body,
      )}
      {shortcuts && createPortal(
        <div className="nv-shortcuts" onMouseDown={(event) => { if (event.target === event.currentTarget) setShortcuts(false); }}>
          <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="nv-shortcuts-panel" tabIndex={-1}>
            <p id={titleId}>{lang === 'zh' ? '快捷键' : 'Keyboard shortcuts'}</p>
            <dl>
              {rows.map((row) => (
                <div key={row.keys}>
                  <dt>{row.keys}</dt>
                  <dd>{row.label}</dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => setShortcuts(false)}>{lang === 'zh' ? '关闭' : 'Close'}</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export function ShortcutButton({ className = '' }: { className?: string }) {
  const lang = useLang();
  return (
    <button
      type="button"
      className={`command-launch${className ? ` ${className}` : ''}`}
      aria-keyshortcuts="?"
      aria-label={lang === 'zh' ? '快捷键，问号' : 'Keyboard shortcuts, question mark'}
      title={lang === 'zh' ? '快捷键' : 'Shortcuts'}
      onClick={() => openShortcuts()}
    >
      <span aria-hidden="true">?</span>
    </button>
  );
}
