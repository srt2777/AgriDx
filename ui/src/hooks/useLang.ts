import { useSyncExternalStore } from 'react';
import type { Lang } from '@/data/content';

const STORAGE_KEY = 'srt-lang';
function readSavedLang(): Lang {
  try { return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}
let memoryLang: Lang = readSavedLang();

function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      memoryLang = event.newValue === 'en' ? 'en' : 'zh';
      document.documentElement.lang = memoryLang === 'zh' ? 'zh-CN' : 'en';
      callback();
    }
  };
  window.addEventListener('storage', onStorage);
  // 自定义事件：同标签内切换语言时也能触发
  window.addEventListener('srt-lang-changed', callback as EventListener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('srt-lang-changed', callback as EventListener);
  };
}

function getSnapshot(): Lang {
  return memoryLang;
}

/** 读取当前语言（zh / en），切换时自动重渲染 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'zh');
}

/** 切换语言并通知所有订阅者 */
export function setLang(lang: Lang) {
  memoryLang = lang;
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* Keep this tab's selection. */ }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  window.dispatchEvent(new Event('srt-lang-changed'));
}
