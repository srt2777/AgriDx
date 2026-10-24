import { useSyncExternalStore } from 'react';

export type UiVersion = 'new' | 'old';
const STORAGE_KEY = 'agridx-ui-version';
const CHANGE_EVENT = 'agridx-ui-version-changed';
function readSavedVersion(): UiVersion {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'old' ? 'old' : 'new';
  } catch { /* The switch still works when browser storage is unavailable. */ }
  return 'new';
}
let memoryVersion: UiVersion = readSavedVersion();
const getSnapshot = () => memoryVersion;

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      memoryVersion = event.newValue === 'old' ? 'old' : 'new';
      callback();
    }
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useUiVersion(): UiVersion {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'new');
}

export function setUiVersion(version: UiVersion) {
  memoryVersion = version;
  try { window.localStorage.setItem(STORAGE_KEY, version); } catch { /* Keep this tab's selection. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
