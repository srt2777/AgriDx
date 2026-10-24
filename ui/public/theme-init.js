/* Runs before the page paints; both production and development use this controller. */
(function () {
  const key = 'srt-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  const valid = value => value === 'light' || value === 'dark';
  let preference = null;
  try {
    const saved = window.localStorage.getItem(key);
    if (valid(saved)) preference = saved;
  } catch { /* Private browsing can disable storage. */ }
  let theme;
  function apply() {
    const next = preference || (media.matches ? 'dark' : 'light');
    const changed = theme !== next;
    theme = next;
    const root = document.documentElement;
    root.classList.toggle('theme-dark', theme === 'dark');
    root.classList.toggle('theme-light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111820' : '#f8faf8');
    if (changed) listeners.forEach(listener => listener());
  }
  window.agridxTheme = {
    getSnapshot: () => theme,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTheme(next) {
      if (!valid(next)) return;
      preference = next;
      try { window.localStorage.setItem(key, next); } catch { /* Keep the selection in this tab. */ }
      apply();
    },
  };
  media.addEventListener('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = valid(event.newValue) ? event.newValue : null;
      apply();
    }
  });
  apply();
})();
