import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/theme-init.js', import.meta.url), 'utf8');
interface Controller {
  getSnapshot(): 'light' | 'dark';
  setTheme(theme: 'light' | 'dark'): void;
  subscribe(listener: () => void): () => void;
}
function browser(saved: string | null, dark = false, blocked = false) {
  const classes = new Set<string>();
  const root = { classList: { toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name) }, dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  let mediaChanged = () => {};
  let storageChanged = (_event: { key: string | null; newValue: string | null }) => {};
  let chrome = '';
  const media = { matches: dark, addEventListener: (_name: string, listener: () => void) => { mediaChanged = listener; } };
  const window = {
    matchMedia: () => media,
    localStorage: {
      getItem: () => { if (blocked) throw Error('Storage blocked'); return saved; },
      setItem: (_key: string, value: string) => { if (blocked) throw Error('Storage blocked'); saved = value; },
    },
    addEventListener: (_name: string, listener: typeof storageChanged) => { storageChanged = listener; },
  } as unknown as { agridxTheme: Controller };
  runInNewContext(source, { window, document: { documentElement: root, querySelector: () => ({ setAttribute: (_key: string, value: string) => { chrome = value; } }) } });
  return {
    controller: window.agridxTheme, classes, root, saved: () => saved, chrome: () => chrome,
    system: (next: boolean) => { media.matches = next; mediaChanged(); },
    storage: (key: string | null, value: string | null) => storageChanged({ key, newValue: value }),
  };
}

test('保存的浅色选择在深色系统中于首屏前生效，原生控件和浏览器顶栏同步', () => {
  const b = browser('light', true);
  assert.equal(b.controller.getSnapshot(), 'light');
  assert.equal(b.root.style.colorScheme, 'light');
  assert.equal(b.root.dataset.theme, 'light');
  assert.equal(b.chrome(), '#f8faf8');
  assert.ok(b.classes.has('theme-light'));
  assert.ok(!b.classes.has('dark'));
});

test('未选择主题时跟随系统；手动切换后系统变化不覆盖用户选择', () => {
  const b = browser(null);
  b.system(true);
  assert.equal(b.controller.getSnapshot(), 'dark');
  b.controller.setTheme('light');
  b.system(false); b.system(true);
  assert.equal(b.controller.getSnapshot(), 'light');
  assert.equal(b.saved(), 'light');
});

test('同源标签页同步主题，清除选择后重新跟随系统且不影响其他存储事件', () => {
  const b = browser('light', true);
  let notifications = 0;
  const unsubscribe = b.controller.subscribe(() => { notifications++; });
  b.storage('srt-theme', 'dark');
  assert.equal(b.controller.getSnapshot(), 'dark');
  assert.equal(notifications, 1);
  b.storage('other-key', 'light');
  assert.equal(b.controller.getSnapshot(), 'dark');
  b.storage('srt-theme', 'light');
  b.storage(null, null);
  assert.equal(b.controller.getSnapshot(), 'dark');
  unsubscribe(); b.controller.setTheme('light');
  assert.equal(notifications, 3);
});

test('存储不可用或历史选择无效时仍可切换，类名与原生控件保持一致', () => {
  for (const b of [browser('invalid', true), browser(null, true, true)]) {
    b.controller.setTheme('light');
    assert.equal(b.controller.getSnapshot(), 'light');
    assert.equal(b.root.style.colorScheme, 'light');
    assert.ok(b.classes.has('theme-light'));
    assert.ok(!b.classes.has('theme-dark'));
    assert.ok(!b.classes.has('dark'));
  }
});
