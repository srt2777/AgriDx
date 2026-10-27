/** Names shared by a campus pavilion and the page it opens. */
export const PAVILION_TRANSITION = {
  knowledge: 'pavilion-knowledge',
  diagnosis: 'pavilion-diagnosis',
  models: 'pavilion-models',
} as const;

export const HALL_ZONE_TRANSITION = 'hall-knowledge';

const TARGETS: Record<string, string> = {
  'pavilion-knowledge': 'knowledge',
  'hall-knowledge': 'knowledge',
  'pavilion-diagnosis': 'diagnosis',
  'pavilion-models': 'models',
};

export function sharedTransitionName(kind: 'pavilion' | 'hall', id: string): string | null {
  if (kind === 'hall') return HALL_ZONE_TRANSITION;
  if (id in PAVILION_TRANSITION) return PAVILION_TRANSITION[id as keyof typeof PAVILION_TRANSITION];
  return null;
}

export function sharedTarget(name: string | null): string | null {
  if (!name) return null;
  return TARGETS[name] ?? null;
}

export function shouldUseViewTransition(reduced: boolean, supported: boolean): boolean {
  return !reduced && supported;
}

function viewTransitionSupported(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

/** Cross-fade the route. When `name` is set, the source morphs into `[data-shared-target]`. */
export function beginSharedTransition(name: string | null, update: () => void, source?: Element | null) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  const named = source instanceof HTMLElement ? source : null;
  const previous = named?.style.viewTransitionName ?? '';
  if (name) root.dataset.shared = name;
  if (name && named) named.style.viewTransitionName = 'route-shared';
  const clear = () => {
    if (root.dataset.shared === name) delete root.dataset.shared;
    if (named) named.style.viewTransitionName = previous;
  };
  if (!shouldUseViewTransition(reduced, viewTransitionSupported())) {
    update();
    clear();
    return;
  }
  const target = sharedTarget(name);
  try {
    const transition = document.startViewTransition(() => {
      update();
      if (!target) return undefined;
      return new Promise<void>((resolve) => {
        const started = performance.now();
        const tick = () => {
          if (document.querySelector(`[data-shared-target="${target}"]`) || performance.now() - started > 1800) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    });
    transition.finished.finally(clear);
  } catch {
    update();
    clear();
  }
}
