/** A published build is immutable; a different, verified same-origin build is loaded only while idle. */
export interface ReleaseUpdaterRuntime {
  fetch: (url: string, options: RequestInit) => Promise<Response>;
  getUrl: () => string;
  replace: (url: string) => void;
  isVisible: () => boolean;
  subscribe: (event: 'visibilitychange' | 'online' | 'focus', listener: () => void) => () => void;
  setInterval: (callback: () => void, delay: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'>;
  readHtmlCommit: (html: string) => string | null;
}

export interface ReleaseUpdaterOptions {
  currentCommit: string;
  currentVersion?: string;
  manifestUrl: string;
  canReload: () => boolean;
  onPending?: (commit: string | null) => void;
  runtime?: ReleaseUpdaterRuntime;
}

const SHA = /^[0-9a-f]{40}$/;
const STORAGE_KEY = 'agridx:release-transitions:v1';
const TARGET_PARAM = '__agridx_build';
const PREVIOUS_PARAM = '__agridx_previous';
const CHECK_PARAM = '__agridx_check';

function browserRuntime(): ReleaseUpdaterRuntime {
  return {
    fetch: (url, options) => window.fetch(url, options),
    getUrl: () => window.location.href,
    replace: url => window.location.replace(url),
    isVisible: () => !document.hidden,
    subscribe: (event, listener) => {
      const target = event === 'visibilitychange' ? document : window;
      target.addEventListener(event, listener);
      return () => target.removeEventListener(event, listener);
    },
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: handle => window.clearInterval(handle as number),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: handle => window.clearTimeout(handle as number),
    now: Date.now,
    getStorage: () => window.sessionStorage,
    readHtmlCommit: html => {
      const elements = new DOMParser().parseFromString(html, 'text/html')
        .querySelectorAll('meta[name="agridx-build-commit"]');
      return elements.length === 1 ? elements[0].getAttribute('content') : null;
    },
  };
}

function versionParts(value: unknown): number[] | null {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersion(left: number[], right: number[]): number {
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  return 0;
}

interface Transition { from: string; to: string }
interface Release { commit: string; version: number[] }

/**
 * Published manifests are controlled by the main-only deployment pipeline. SHA values are
 * not sortable: additionally reject lower project versions and already superseded commits.
 * The HTML identity and a second manifest read prevent mixed-CDN responses from reloading.
 */
export function startReleaseUpdater(options: ReleaseUpdaterOptions) {
  const runtime = options.runtime ?? browserRuntime();
  let stopped = false, navigated = false;
  let inFlight: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let timeout: unknown;
  let pending: string | null = null;
  const attempts = new Set<string>();
  const history: Transition[] = [];
  const currentVersion = options.currentVersion === undefined ? null : versionParts(options.currentVersion);
  const noop = async () => {};
  const disabled = { stop: () => {}, check: noop, retryPending: noop };
  let initialUrl: URL, manifest: URL;
  try {
    initialUrl = new URL(runtime.getUrl());
    manifest = new URL(options.manifestUrl, initialUrl);
    if (!SHA.test(options.currentCommit) ||
        (options.currentVersion !== undefined && !currentVersion) ||
        !/^https?:$/.test(initialUrl.protocol) || manifest.origin !== initialUrl.origin ||
        manifest.username || manifest.password || initialUrl.username || initialUrl.password) return disabled;
  } catch { return disabled; }
  try {
    const stored: unknown = JSON.parse(runtime.getStorage().getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(stored)) {
      for (const item of stored.slice(-20)) {
        if (item && typeof item === 'object' && SHA.test(item.from) && SHA.test(item.to)) history.push({ from: item.from, to: item.to });
      }
    }
  } catch {
    // Private browsing may deny storage. URL markers and in-memory guards still apply.
  }
  const origin = initialUrl.origin;
  const superseded = new Set(history.map(item => item.from));
  const previous = initialUrl.searchParams.get(PREVIOUS_PARAM);
  if (previous && SHA.test(previous) && previous !== options.currentCommit) superseded.add(previous);
  const setPending = (value: string | null) => {
    if (pending === value) return;
    pending = value;
    try { options.onPending?.(value); } catch { /* Notifications do not control navigation safety. */ }
  };
  const idle = () => {
    try { return !stopped && !navigated && runtime.isVisible() && options.canReload(); }
    catch { return false; }
  };
  const attempted = (target: string) => attempts.has(target) ||
    history.some(item => item.from === options.currentCommit && item.to === target) ||
    (initialUrl.searchParams.get(TARGET_PARAM) === target && target !== options.currentCommit);
  const freshUrl = (url: URL) => {
    const value = new URL(url);
    value.hash = '';
    value.searchParams.set(CHECK_PARAM, String(runtime.now()));
    return value.href;
  };
  const release = (value: unknown): Release | null => {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const version = versionParts(row.version);
    return typeof row.commit === 'string' && SHA.test(row.commit) && version &&
      (!currentVersion || compareVersion(version, currentVersion) >= 0) ? { commit: row.commit, version } : null;
  };
  const performCheck = async () => {
    const active = new AbortController();
    controller = active;
    timeout = runtime.setTimeout(() => active.abort(), 12_000);
    const ensureActive = () => {
      active.signal.throwIfAborted();
      if (stopped || navigated || new URL(runtime.getUrl()).origin !== origin) throw new Error('Updater is inactive');
    };
    const request = async (url: URL) => {
      ensureActive();
      const response = await runtime.fetch(freshUrl(url), {
        cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: active.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      ensureActive();
      if (!response.ok || response.redirected || (response.url && new URL(response.url).origin !== origin)) {
        throw new Error('Untrusted release response');
      }
      return response;
    };
    try {
      const latest = release(await (await request(manifest)).json());
      ensureActive();
      if (!latest) return;
      if (latest.commit === options.currentCommit) { setPending(null); return; }
      if (superseded.has(latest.commit) || attempted(latest.commit)) return;
      setPending(latest.commit);
      if (!idle()) return;
      const html = await (await request(new URL(runtime.getUrl()))).text();
      ensureActive();
      if (runtime.readHtmlCommit(html) !== latest.commit || !idle()) return;
      // A newer deployment may have arrived while the HTML was being fetched.
      const confirmed = release(await (await request(manifest)).json());
      ensureActive();
      if (!confirmed || confirmed.commit !== latest.commit || compareVersion(confirmed.version, latest.version) !== 0) {
        if (confirmed && confirmed.commit !== options.currentCommit && !superseded.has(confirmed.commit)) setPending(confirmed.commit);
        return;
      }
      if (!idle() || attempted(latest.commit)) return;
      const target = new URL(runtime.getUrl());
      if (target.origin !== origin || target.username || target.password) return;
      target.searchParams.set(TARGET_PARAM, latest.commit);
      target.searchParams.set(PREVIOUS_PARAM, options.currentCommit);
      attempts.add(latest.commit);
      history.push({ from: options.currentCommit, to: latest.commit });
      try { runtime.getStorage().setItem(STORAGE_KEY, JSON.stringify(history.slice(-20))); } catch { /* URL and memory remain authoritative. */ }
      navigated = true;
      runtime.replace(target.href);
    } catch { /* A failed update check must never interrupt the working application. */ }
    finally {
      runtime.clearTimeout(timeout);
      if (controller === active) controller = undefined;
    }
  };
  const check = (): Promise<void> => {
    if (stopped || navigated || !runtime.isVisible()) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = performCheck().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const listener = () => { void check(); };
  const interval = runtime.setInterval(listener, 30_000);
  const unsubscribe = (['visibilitychange', 'online', 'focus'] as const).map(event => runtime.subscribe(event, listener));
  void check();
  return {
    check,
    retryPending: check,
    stop: () => {
      stopped = true;
      controller?.abort();
      runtime.clearTimeout(timeout);
      runtime.clearInterval(interval);
      unsubscribe.forEach(remove => remove());
    },
  };
}
