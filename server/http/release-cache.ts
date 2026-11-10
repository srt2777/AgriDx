const NO_STORE = new Set(['/deployment.json', '/deployment-automation.json']);
const NO_CACHE = new Set(['/', '/index.html', '/theme-init.js']);

/** Cache policy for release identity files. Hashed build assets are unchanged. */
export function releaseCacheControl(requestPath: string): 'no-store' | 'no-cache' | undefined {
  const pathOnly = (requestPath.split('?')[0] || '/').replace(/\/{2,}/g, '/');
  if (NO_STORE.has(pathOnly)) return 'no-store';
  if (NO_CACHE.has(pathOnly)) return 'no-cache';
  return undefined;
}
