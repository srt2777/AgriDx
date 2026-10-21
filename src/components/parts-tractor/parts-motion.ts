export type StudioPresentation = 'solid' | 'isolate' | 'xray';

export type PartVisual = {
  opacity: number;
  depthWrite: boolean;
  desaturate: number;
  pulse: boolean;
  outline: boolean;
};

/** Shells that hide the powertrain. Fault mode turns these into a faint x-ray. */
export const OCCLUDING_PARTS = new Set(['engine_hood', 'cab', 'fenders', 'headlights']);

/** Parts the x-ray is meant to reveal. */
export const INTERNAL_PARTS = new Set(['engine', 'gearbox', 'clutch', 'battery']);

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Smoothstep. The exploded offset uses this, so the ends ease in and out. */
export function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** Local position = base + explode_dir * eased(t). t is 0..1. */
export function explodedPosition(
  base: readonly [number, number, number],
  dir: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const eased = smoothstep(t);
  return [
    base[0] + dir[0] * eased,
    base[1] + dir[1] * eased,
    base[2] + dir[2] * eased,
  ];
}

export function partVisual(input: {
  partId: string;
  selected: boolean;
  hovered: boolean;
  hasSelection: boolean;
  presentation: StudioPresentation;
  faultPartId: string | null;
}): PartVisual {
  const { partId, selected, hovered, hasSelection, presentation, faultPartId } = input;
  const outline = selected || hovered;
  if (faultPartId) {
    const faulted = partId === faultPartId;
    const open = INTERNAL_PARTS.has(faultPartId) && OCCLUDING_PARTS.has(partId) && !faulted;
    if (faulted) return { opacity: 1, depthWrite: true, desaturate: 0, pulse: true, outline };
    if (open) return { opacity: 0.15, depthWrite: false, desaturate: 0.35, pulse: false, outline: false };
    return {
      opacity: presentation === 'xray' ? 0.22 : 0.42,
      depthWrite: presentation !== 'xray',
      desaturate: 0.72,
      pulse: false,
      outline,
    };
  }
  if (presentation === 'isolate' && hasSelection) {
    return { opacity: selected ? 1 : 0, depthWrite: selected, desaturate: 0, pulse: false, outline: selected || hovered };
  }
  if (presentation === 'xray') {
    const solid = !hasSelection || selected;
    return { opacity: solid && hasSelection ? 1 : 0.22, depthWrite: solid && hasSelection, desaturate: 0, pulse: false, outline };
  }
  return { opacity: 1, depthWrite: true, desaturate: 0, pulse: false, outline };
}
