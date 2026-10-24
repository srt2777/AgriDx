/** A manual choice wins over responsive defaults for this visit only. */
export function partOutlines(mobile: boolean, coarse: boolean, choice: boolean | null): boolean {
  return choice ?? (!mobile && !coarse);
}

/** R3F reports the pointer's movement before click; rotation/panning is not a part tap. */
export function isPartTap(delta: number, button: number, primary = true): boolean {
  return primary && button === 0 && Number.isFinite(delta) && delta >= 0 && delta <= 5;
}

/** Read primary status on pointerdown: compatibility click events may omit or reset that flag. */
export function createPartGesture() {
  let primary = true;
  return {
    start(value: boolean) { primary = value; },
    cancel() { primary = false; },
    accepts(delta: number, button: number) { return isPartTap(delta, button, primary); },
  };
}

/** Fit the limiting horizontal/vertical field of view, including portrait screens. */
export function partFocusDistance(radius: number, fov: number, aspect: number, minimum: number): number {
  const half = (Number.isFinite(fov) && fov > 0 && fov < 180 ? fov : 38) * Math.PI / 360;
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const limiting = Math.min(half, Math.atan(Math.tan(half) * ratio));
  const size = Number.isFinite(radius) && radius > 0 ? radius : 0;
  return Math.min(80, Math.max(minimum, size / Math.sin(limiting) * 1.35));
}

export function bindPartFocusInterrupt(controls: {
  addEventListener(type: 'start', callback: () => void): void;
  removeEventListener(type: 'start', callback: () => void): void;
}, transition: { active: boolean }): () => void {
  const interrupt = () => { transition.active = false; };
  controls.addEventListener('start', interrupt);
  return () => controls.removeEventListener('start', interrupt);
}

/** Native buttons retain Enter/Space; arrows supplement Tab without inventing an ARIA tree. */
export function partListIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return Math.min(count - 1, Math.max(0, current + 1));
  if (key === 'ArrowUp' || key === 'ArrowLeft') return Math.max(0, current - 1);
  return null;
}

type FocusTarget = { isConnected: boolean; disabled?: boolean; focus(): void };
export function restorePartFocus(preferred: FocusTarget | null, fallback: FocusTarget | null): boolean {
  const target = preferred?.isConnected && !preferred.disabled ? preferred : fallback?.isConnected && !fallback.disabled ? fallback : null;
  target?.focus();
  return target !== null;
}
