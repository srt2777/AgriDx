import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDiagnosticContext } from '../server/knowledge/conversation';

const user = (content: string) => ({ role: 'user', content });

for (const correction of [
  '不是久保田，是东方红',
  '不是久保田而是东方红',
  '并非久保田，而是东方红',
  '不属于久保田，是东方红',
]) {
  test(`identity correction preserves same-turn observations: ${correction}`, () => {
    const context = resolveDiagnosticContext([
      user('久保田 LX2620 拖拉机水温过高'),
      user(`补充冷却液泄漏，${correction}`),
    ]);
    assert.equal(context.scope.brand, '东方红');
    assert.equal(context.scope.model, undefined);
    assert.equal(context.clarificationNeeded, false);
    assert.match(context.symptomQuery, /水温过高/);
    assert.match(context.symptomQuery, /冷却液泄漏/);
    assert.doesNotMatch(context.query, /久保田|LX2620/i);
  });
}

test('a correction does not discard an independent new symptom before the identity clause', () => {
  const context = resolveDiagnosticContext([
    user('久保田 LX2620 拖拉机水温过高'),
    user('发动机无法起动，不是久保田，是东方红'),
  ]);
  assert.match(context.topicRoot, /无法起动/);
  assert.doesNotMatch(context.symptomQuery, /水温过高/);
});

test('a turn with two corrections keeps the observation and both replacement identities', () => {
  const context = resolveDiagnosticContext([
    user('补充冷却液泄漏，不是久保田，是东方红；不是LX2620，是型号LF1504'),
  ]);
  assert.equal(context.scope.brand, '东方红');
  assert.match(context.scope.model ?? '', /lf1504/i);
  assert.match(context.symptomQuery, /冷却液泄漏/);
  assert.doesNotMatch(context.query, /久保田|LX2620/i);
});

test('machine-type denial clears stale selection constraints even before a replacement arrives', () => {
  const history = [
    user('久保田 LX2620 拖拉机 国四 两驱 驾驶室 起动机不转'),
    user('不是拖拉机'),
  ];
  const pending = resolveDiagnosticContext(history, { machineType: '拖拉机', brand: '久保田', model: 'LX2620' });
  assert.equal(pending.clarificationNeeded, true);
  assert.deepEqual(pending.scope, {});
  assert.deepEqual(pending.conditions, []);
  const replacement = resolveDiagnosticContext([...history, user('联合收割机')]);
  assert.equal(replacement.clarificationNeeded, false);
  assert.equal(replacement.scope.machineType, '联合收割机');
  assert.match(replacement.symptomQuery, /起动机不转/);
  assert.doesNotMatch(replacement.query, /国四|CAB|2WD|久保田|LX2620/i);
});

test('new constraints supplied alongside a machine denial remain current user declarations', () => {
  const context = resolveDiagnosticContext([
    user('拖拉机 国三 两驱 驾驶室 起动机不转'),
    user('不是拖拉机，国四，四驱，防翻滚架'),
    user('联合收割机'),
  ]);
  assert.deepEqual(context.conditions, ['国四', 'ROPS', '4WD']);
  assert.doesNotMatch(context.query, /国三|CAB|2WD/);
});

test('same-machine brand corrections keep previously declared applicability constraints', () => {
  const context = resolveDiagnosticContext([
    user('久保田 LX2620 拖拉机 国四 两驱 驾驶室 起动机不转'),
    user('不是久保田，是东方红'),
  ]);
  assert.deepEqual(context.conditions, ['国四', 'CAB', '2WD']);
  assert.match(context.symptomQuery, /起动机不转/);
});

test('assistant suggestions cannot restore a denied type or selection constraints', () => {
  const context = resolveDiagnosticContext([
    user('拖拉机 国三 两驱 起动机不转'), user('不是拖拉机'),
    { role: 'assistant', content: '那是国三两驱拖拉机吗？' },
    user('只有热车才出现'),
  ]);
  assert.equal(context.clarificationNeeded, true);
  assert.deepEqual(context.conditions, []);
  assert.equal(context.scope.machineType, undefined);
  assert.doesNotMatch(context.query, /国三|2WD/);
});
