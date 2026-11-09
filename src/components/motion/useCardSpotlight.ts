/**
 * One pointer listener for every opted-in card.
 * Coordinates are written as CSS variables on the card, throttled to one frame.
 * A move writes style properties only, so React does not re-render.
 */
const HOST = '.new-version-shell, .fo-shell';
const CARD = '.card-spotlight';

type Pending = { card: HTMLElement | null; x: number; y: number };

export function bindCardSpotlight(doc: Document): () => void {
  const coarse = window.matchMedia('(pointer: coarse)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let enabled = !coarse.matches && !reduced.matches;
  let frame = 0;
  let active: HTMLElement | null = null;
  let pending: Pending | null = null;

  const clear = (card: HTMLElement | null) => {
    if (!card) return;
    card.removeAttribute('data-spot');
  };

  const flush = () => {
    frame = 0;
    const next = pending;
    pending = null;
    if (!enabled || !next?.card) {
      clear(active);
      active = null;
      return;
    }
    if (active && active !== next.card) clear(active);
    const rect = next.card.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      clear(active);
      active = null;
      return;
    }
    active = next.card;
    if (!active.dataset.spotAnchor) {
      active.dataset.spotAnchor = getComputedStyle(active).position === 'static' ? 'relative' : 'keep';
    }
    active.style.setProperty('--spot-x', `${next.x - rect.left}px`);
    active.style.setProperty('--spot-y', `${next.y - rect.top}px`);
    if (active.dataset.spot !== 'on') active.dataset.spot = 'on';
  };

  const schedule = (card: HTMLElement | null, x: number, y: number) => {
    pending = { card, x, y };
    if (frame === 0) frame = requestAnimationFrame(flush);
  };

  const onMove = (event: PointerEvent) => {
    if (!enabled || (event.pointerType && event.pointerType !== 'mouse')) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const host = target.closest(HOST);
    const card = host ? target.closest(CARD) : null;
    const hit = card instanceof HTMLElement && host instanceof Element && host.contains(card) ? card : null;
    schedule(hit, event.clientX, event.clientY);
  };

  const onOut = (event: PointerEvent) => {
    if (event.relatedTarget == null) schedule(null, 0, 0);
  };

  const sync = () => {
    enabled = !coarse.matches && !reduced.matches;
    if (!enabled) schedule(null, 0, 0);
  };

  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerout', onOut);
  coarse.addEventListener('change', sync);
  reduced.addEventListener('change', sync);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    clear(active);
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerout', onOut);
    coarse.removeEventListener('change', sync);
    reduced.removeEventListener('change', sync);
  };
}
