import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export function useTheme(): Theme {
  return useSyncExternalStore(window.agridxTheme.subscribe, window.agridxTheme.getSnapshot, () => 'light');
}

export function setTheme(theme: Theme) {
  window.agridxTheme.setTheme(theme);
}
