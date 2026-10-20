import { easeOutCubic } from './motion-tokens';

/** Hover delay before the shared glass tooltip appears. */
export const TOOLTIP_DELAY_MS = 320;

/** Cards wider than this stay flat so a tilt does not swing the whole page. */
export const TILT_FLAT_WIDTH = 720;

export const TILT_SELECTOR = [
  '[data-ui-version="new"] .hall-card',
  '[data-ui-version="new"] .chat-context',
  '[data-ui-version="new"] .hall-drawer',
  '[data-ui-version="new"] .expo-catalog-sheet',
  '[data-ui-version="new"] .not-found-card',
].join(', ');

export const PRESS_SELECTOR = [
  '[data-ui-version="new"] .expo-start-button',
  '[data-ui-version="new"] .expo-hall-link',
  '[data-ui-version="new"] .glass-button:not(.glass-secondary)',
  '[data-ui-version="new"] .hall-drawer > a',
].join(', ');

export function openShortcuts(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('agridx-shortcuts-open'));
}

export function tiltAllowed(options: { fine: boolean; reduced: boolean }): boolean {
  return options.fine && !options.reduced;
}

/** Narrow cards tilt a few degrees. Wide panels stay still. */
export function tiltAmount(width: number): number {
  if (width >= TILT_FLAT_WIDTH) return 0;
  if (width >= 480) return 2.5;
  return 4.5;
}

export function pointerTilt(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number,
): { x: number; y: number } | null {
  const max = tiltAmount(rect.width);
  if (max === 0 || rect.width < 8 || rect.height < 8) return null;
  const px = (x - rect.left) / rect.width;
  const py = (y - rect.top) / rect.height;
  if (px < 0 || px > 1 || py < 0 || py > 1) return null;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    x: round((0.5 - py) * 2 * max),
    y: round((px - 0.5) * 2 * max),
  };
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
