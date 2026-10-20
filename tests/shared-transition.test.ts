import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filterCommands, notFoundCopy, statusPlace } from '../src/lib/command-routes';
import { sharedTarget, sharedTransitionName, shouldUseViewTransition } from '../src/lib/shared-transition';

test('展区跳转使用共享过渡名，减少动态时退回直接导航', () => {
  assert.equal(sharedTransitionName('pavilion', 'knowledge'), 'pavilion-knowledge');
  assert.equal(sharedTransitionName('pavilion', 'diagnosis'), 'pavilion-diagnosis');
  assert.equal(sharedTransitionName('pavilion', 'models'), 'pavilion-models');
  assert.equal(sharedTransitionName('pavilion', 'research'), null);
  assert.equal(sharedTransitionName('hall', 'A'), 'hall-knowledge');
  assert.equal(sharedTarget('pavilion-knowledge'), 'knowledge');
  assert.equal(sharedTarget('hall-knowledge'), 'knowledge');
  assert.equal(sharedTarget('pavilion-hall'), 'hall');
  assert.equal(shouldUseViewTransition(true, true), false);
  assert.equal(shouldUseViewTransition(false, false), false);
  assert.equal(shouldUseViewTransition(false, true), true);
});

test('快速前往可按中英文筛选，状态条和 404 文案跟着语言走', () => {
  assert.deepEqual(filterCommands('').map((item) => item.id), ['hub', 'hall', 'knowledge', 'models', 'chat']);
  assert.deepEqual(filterCommands('结构').map((item) => item.id), ['models']);
  assert.deepEqual(filterCommands('catalog').map((item) => item.id), ['knowledge']);
  assert.equal(filterCommands('没有这个地方').length, 0);
  assert.equal(statusPlace('/hall', 'zh'), '数字展厅');
  assert.equal(statusPlace('/models', 'en'), 'MODEL STUDIO');
  assert.equal(statusPlace('/missing', 'zh'), '未找到');
  assert.match(notFoundCopy('zh').title, /页面未找到/);
  assert.match(notFoundCopy('en').note, /hub, hall, or catalog/);
});
