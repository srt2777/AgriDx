import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/ui/classic-system.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('窄屏旧版知识浏览方式换行，避免最后一个入口被挤出屏幕', () => {
  const narrow = css.slice(css.indexOf('@media (max-width: 600px)'));
  assert.notEqual(narrow.indexOf('.library-collections'), -1);
  const rule = narrow.slice(narrow.indexOf('.fluid-workspace[data-ui-version=\'old\'] .library-collections'));
  assert.match(rule, /flex-wrap:\s*wrap/);
  assert.match(rule, /overflow-x:\s*visible/);
  // Wider classic layouts can still scroll a single row.
  const tablet = css.slice(css.indexOf('@media (max-width: 899px)'), css.indexOf('@media (max-width: 600px)'));
  assert.match(tablet, /flex-wrap:\s*nowrap/);
});
