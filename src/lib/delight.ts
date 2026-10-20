import { easeOutCubic } from './motion-tokens';

/** Hover delay before the shared glass tooltip appears. */
export const TOOLTIP_DELAY_MS = 320;

/** Status ring eases in once. Longer than the page counters so the draw reads. */
export const RING_DRAW_MS = 1600;

export const PRESS_SCALE = 0.98;

/** A scan plays only when the hall zone actually changes. */
export function zoneSweep(previous: string, next: string): boolean {
  return previous !== next;
}

export function openShortcuts(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agridx-shortcuts-open'));
}

export function scrollProgress(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const range = scrollHeight - clientHeight;
  if (range <= 1) return 0;
  return Math.min(1, Math.max(0, scrollTop / range));
}

export function countFrame(goal: number, elapsedMs: number, durationMs: number, reduced: boolean): number {
  if (reduced || durationMs <= 0) return goal;
  const t = Math.min(1, Math.max(0, elapsedMs / durationMs));
  return goal * easeOutCubic(t);
}

export function typingElement(tagName: string, editable: boolean): boolean {
  return editable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return typingElement(target.tagName, target.isContentEditable);
}

export function shortcutToggleKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing?: boolean }): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  return event.key === '?' || event.key === '？';
}

export function shortcutRows(lang: 'zh' | 'en'): { keys: string; label: string }[] {
  if (lang === 'en') {
    return [
      { keys: '?', label: 'Open or close this list' },
      { keys: 'Ctrl K / ⌘K', label: 'Quick navigation' },
      { keys: 'Esc', label: 'Close a layer, the intro, or a zone drawer' },
      { keys: '← →', label: 'Move between hall zones' },
      { keys: '/', label: 'Open campus evidence search' },
    ];
  }
  return [
    { keys: '?', label: '打开或关闭这张表' },
    { keys: 'Ctrl K / ⌘K', label: '快速前往' },
    { keys: 'Esc', label: '关闭浮层、片头或展区抽屉' },
    { keys: '← →', label: '切换数字展厅展区' },
    { keys: '/', label: '打开园区资料搜索' },
  ];
}

export function tooltipPlacement(
  anchor: { left: number; top: number; width: number; height: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
): { left: number; top: number; above: boolean; arrow: number } {
  const center = anchor.left + anchor.width / 2;
  const left = Math.min(Math.max(8, center - tip.width / 2), Math.max(8, viewport.width - tip.width - 8));
  const aboveTop = anchor.top - gap - tip.height;
  const above = aboveTop >= 8;
  const top = above ? aboveTop : Math.min(anchor.top + anchor.height + gap, viewport.height - tip.height - 8);
  const arrow = Math.min(Math.max(14, center - left), Math.max(14, tip.width - 14));
  return { left, top, above, arrow };
}
