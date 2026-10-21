import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMAND_ROUTES, filterCommands, notFoundCopy, statusPlace } from '../src/lib/command-routes';
import { sharedTarget, sharedTransitionName, shouldUseViewTransition } from '../src/lib/shared-transition';
import { WORLD_ZONES, pavilionDestination } from '../src/pages/ExhibitionPage/world-navigation';

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

test('园区展区路径、过渡名和快速前往落在真实页面上', () => {
  assert.deepEqual(pavilionDestination('knowledge'), { path: '/knowledge', classicResearch: false });
  assert.deepEqual(pavilionDestination('diagnosis'), { path: '/chat', classicResearch: false });
  assert.deepEqual(pavilionDestination('models'), { path: '/models', classicResearch: false });
  assert.deepEqual(pavilionDestination('research'), { path: '/', classicResearch: true });
  for (const zone of WORLD_ZONES) {
    const destination = pavilionDestination(zone.id);
    assert.equal(sharedTransitionName('pavilion', zone.id), destination.classicResearch ? null : `pavilion-${zone.id}`);
    if (!destination.classicResearch) assert.notEqual(statusPlace(destination.path, 'zh'), '未找到');
  }
  assert.equal(COMMAND_ROUTES.length, 5);
  for (const route of COMMAND_ROUTES) {
    assert.notEqual(statusPlace(route.path, 'zh'), '未找到');
    assert.notEqual(statusPlace(route.path, 'en'), 'NOT FOUND');
  }
  assert.equal(filterCommands('展厅')[0]?.path, '/hall');
  assert.equal(filterCommands('diagnosis')[0]?.path, '/chat');
});
