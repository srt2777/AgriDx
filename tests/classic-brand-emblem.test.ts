import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workbenchCss = readFileSync(new URL('../src/ui/workbench.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/ui/WorkspaceShell.tsx', import.meta.url), 'utf8');

test('classic sidebar emblem has no blue focus frame', () => {
  // The global blue :focus-visible outline still applies to the rest of the classic shell.
  assert.match(
    workbenchCss,
    /\.fluid-workspace\[data-ui-version='old'\] :focus-visible\{outline:2px solid var\(--wb-blue\)!important;outline-offset:3px\}/,
  );
  // ...but the brand emblem link opts out of that blue outline.
  assert.match(
    workbenchCss,
    /\.fluid-workspace\[data-ui-version='old'\] \.fluid-brand > a:first-child:focus-visible\{outline:none!important;/,
  );
  // The emblem itself is unchanged: same image, same college link, same size rule.
  assert.match(shell, /njau-engineering-mark\.jpg/);
  assert.match(shell, /https:\/\/coe\.njau\.edu\.cn\//);
  assert.match(
    workbenchCss,
    /\.fluid-workspace\[data-ui-version='old'\] \.fluid-brand img\{width:35px;height:35px;border-radius:9px!important\}/,
  );
});
