import { useSyncExternalStore } from 'react';

export type GlassMode = 'refract' | 'blur' | 'solid';
const QUERIES = [
  '(prefers-reduced-motion: reduce)',
  '(prefers-reduced-transparency: reduce)',
  '(forced-colors: active)',
];

function getMode(): GlassMode {
  if (typeof window === 'undefined') return 'solid';
  const [reducedMotion, reducedTransparency, forcedColors] = QUERIES.map(query => window.matchMedia(query).matches);
  const backdrop = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
  if (!backdrop || reducedTransparency || forcedColors || document.documentElement.classList.contains('glass-off')) return 'solid';
  if (document.documentElement.classList.contains('lg-blur-only')) return 'blur';
  // Native SVG backdrop displacement is a Chromium enhancement; other engines use frosting.
  const chromium = /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  return chromium && !reducedMotion ? 'refract' : 'blur';
}

function subscribe(callback: () => void) {
  const queries = QUERIES.map(query => window.matchMedia(query));
  queries.forEach(query => query.addEventListener('change', callback));
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => {
    queries.forEach(query => query.removeEventListener('change', callback));
    observer.disconnect();
  };
}

export function useGlassMode(): GlassMode {
  return useSyncExternalStore(subscribe, getMode, () => 'solid');
}
