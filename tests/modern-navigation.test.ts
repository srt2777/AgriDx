import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MODERN_DESTINATIONS, modernLocation } from '../src/lib/modern-navigation';
import { COMMAND_ROUTES } from '../src/lib/command-routes';
import { WORLD_ZONES, pavilionDestination } from '../src/pages/ExhibitionPage/world-navigation';

test('hall and all three features share the same destination order and current section', () => {
  assert.deepEqual(MODERN_DESTINATIONS.map(item => item.path), ['/', '/knowledge', '/chat', '/models']);
  assert.deepEqual(COMMAND_ROUTES.slice(0, 4).map(item => item.path), MODERN_DESTINATIONS.map(item => item.path));
  for (const zone of WORLD_ZONES) {
    const destination = pavilionDestination(zone.id);
    const item = MODERN_DESTINATIONS.find(item => item.path === destination.path)!;
    assert.equal(item.zh, zone.zh);
    assert.equal(item.en, zone.en);
    assert.equal(destination.classicResearch, false);
    assert.equal(modernLocation(destination.path).sectionPath, item.path);
    assert.deepEqual(modernLocation(destination.path).breadcrumbs.map(item => item.path), ['/', destination.path]);
  }
  assert.deepEqual(modernLocation('/').breadcrumbs.map(item => item.path), ['/']);
  assert.deepEqual(modernLocation('/hall').breadcrumbs.map(item => item.path), ['/']);
  assert.equal(modernLocation('/knowledge?collection=archive').sectionPath, '/knowledge');
});
test('model child pages retain the model navigation and expose a usable parent path', () => {
  assert.equal(modernLocation('/fault-detection').sectionPath, '/models');
  assert.deepEqual(modernLocation('/fault-detection').breadcrumbs.map(item => item.path), ['/', '/models', '/fault-detection']);
  assert.equal(modernLocation('/version-history').breadcrumbs.at(-1)?.zh, '更新记录');
  assert.notEqual(modernLocation('/unknown').breadcrumbs.at(-1)?.zh, '智能诊断');
});
test('the hall has no second header, main landmark, global feature list or version switch', () => {
  const hall = readFileSync('src/pages/ExhibitionPage/ExhibitionPage.tsx', 'utf8');
  assert.doesNotMatch(hall, /<header className="expo-header"|<main|expo-zone-nav|expo-direct-links|<VersionSwitch|setUiVersion|<SiteStatusBar/);
  const shell = readFileSync('src/components/NewVersionShell.tsx', 'utf8');
  assert.equal((shell.match(/<Outlet/g) ?? []).length, 1);
  assert.match(shell, /MODERN_DESTINATIONS\.map/);
  assert.match(shell, /new-version-navigation-rail/);
});
