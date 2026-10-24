import { useCallback } from 'react';
import { useLang } from '@/hooks/useLang';
import { useUiVersion } from '@/hooks/useUiVersion';
import { classicCopy } from './copy';

/** Shared pages retain their original modern strings; only classic copy is edited. */
export function useUiCopy(language?: string) {
  const currentLang = useLang();
  const version = useUiVersion();
  const lang = language ?? currentLang;
  const classic = version === 'old';
  const format = useCallback((text: string) => classic ? classicCopy(text) : text, [classic]);
  const t = useCallback((zh: string, en: string) => format(lang === 'zh' ? zh : en), [format, lang]);
  return { t, format, separator: classic ? ' ' : ' · ' };
}
