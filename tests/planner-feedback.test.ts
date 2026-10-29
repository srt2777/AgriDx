import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlannerFeedback } from '../agent/planner/feedback';
import { reducePlan } from '../agent/planner';
import { plan, step } from './fixtures/planner';

const base = { episodeId: 'episode-1', eventId: 'feedback-1', stepKey: 'battery', subjectAliases: ['蓄电池', '电瓶'] };

test('explicit synonym feedback is normalized while preserving original user evidence', () => {
  for (const text of ['电瓶检查正常', '蓄电池检查没问题', '检查了，正常', '正常']) {
    const parsed = parsePlannerFeedback({ ...base, text });
    assert.equal(parsed.kind, 'observation');
    if (parsed.kind !== 'observation') throw new Error('Expected observation');
    assert.equal(parsed.event.value, 'normal'); assert.equal(parsed.event.source, 'user_report');
    assert.equal(parsed.evidence.raw, text); assert.equal(parsed.evidence.correction, false);
  }
});

test('explicit checked, unchecked, abnormal and unknown do not imply each other', () => {
  const examples = [['检查过了', 'checked'], ['还没检查', 'unchecked'], ['不正常', 'abnormal'], ['不确定', null]] as const;
  for (const [text, expected] of examples) {
    const parsed = parsePlannerFeedback({ ...base, text });
    assert.equal(parsed.kind, 'observation');
    if (parsed.kind === 'observation') assert.equal(parsed.event.value, expected);
  }
});

test('ambiguous, contradictory, multi-topic and negated inputs require clarification', () => {
  for (const text of ['', '也许正常', '应该没问题', '未检查但正常', '正常但异常', '电瓶正常但水温异常', '没有不正常', '正常吗', '正常？', '蓄电池检查正常但是电压偏低', '不太清楚正常不正常', 'x'.repeat(401)]) {
    assert.equal(parsePlannerFeedback({ ...base, text }).kind, 'clarify', text);
  }
});

test('synonymous repeated reports do not issue another event or consume budget', () => {
  const first = parsePlannerFeedback({ ...base, text: '检查正常' });
  assert.equal(first.kind, 'observation');
  if (first.kind !== 'observation') return;
  const state = reducePlan(plan([step('battery')]), first.event);
  const repeat = parsePlannerFeedback({ ...base, eventId: 'feedback-2', text: '电瓶没问题', previous: state.observations.battery });
  assert.equal(repeat.kind, 'duplicate'); assert.equal(state.observations.battery.verification, 'unverified');
});

test('changed result requires explicit correction and references the latest observation', () => {
  const first = parsePlannerFeedback({ ...base, text: '正常' });
  if (first.kind !== 'observation') throw new Error('Expected observation');
  const state = reducePlan(plan([step('battery')]), first.event);
  assert.equal(parsePlannerFeedback({ ...base, eventId: 'feedback-2', text: '异常', previous: state.observations.battery }).kind, 'clarify');
  const correction = parsePlannerFeedback({ ...base, eventId: 'feedback-2', text: '刚才说错了，电瓶不正常', previous: state.observations.battery });
  assert.equal(correction.kind, 'observation');
  if (correction.kind !== 'observation') return;
  assert.equal(correction.event.corrects, 'feedback-1'); assert.equal(correction.evidence.correction, true);
  const updated = reducePlan(state, correction.event);
  assert.equal(updated.observations.battery.value, 'abnormal'); assert.equal(updated.observations.battery.corrects, 'feedback-1');
  assert.equal(updated.observations.battery.verification, 'unverified');
});

test('orphan correction and unrecognized subjects are never guessed', () => {
  assert.equal(parsePlannerFeedback({ ...base, text: '更正：不正常' }).kind, 'clarify');
  assert.equal(parsePlannerFeedback({ ...base, text: '风扇正常' }).kind, 'clarify');
});

test('a trusted host can refine an unknown observation without erasing its audit trail', () => {
  const unknown = parsePlannerFeedback({ ...base, text: '不确定' });
  if (unknown.kind !== 'observation') throw new Error('Expected observation');
  const state = reducePlan(plan([step('battery')]), unknown.event);
  assert.equal(parsePlannerFeedback({ ...base, eventId: 'feedback-2', text: '正常', previous: state.observations.battery }).kind, 'clarify');
  for (const [text, value] of [['正常', 'normal'], ['不正常', 'abnormal'], ['未检查', 'unchecked']] as const) {
    const refined = parsePlannerFeedback({ ...base, eventId: 'feedback-2', text, previous: state.observations.battery, allowRefineUnknown: true });
    assert.equal(refined.kind, 'observation');
    if (refined.kind !== 'observation') continue;
    assert.equal(refined.event.value, value);
    assert.equal(refined.event.corrects, 'feedback-1');
    const next = reducePlan(state, refined.event);
    assert.equal(next.observations.battery.corrects, 'feedback-1');
    assert.equal(next.audit[0].eventId, 'feedback-1');
  }
  assert.equal(parsePlannerFeedback({ ...base, text: '检查过了', previous: state.observations.battery, allowRefineUnknown: true }).kind, 'clarify');
  assert.equal(parsePlannerFeedback({ ...base, text: '不正常', previous: { eventId: 'prior', value: 'normal', source: 'user_report' }, allowRefineUnknown: true }).kind, 'clarify');
});
