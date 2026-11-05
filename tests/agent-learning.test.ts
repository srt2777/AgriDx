import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildDiagnosticTrajectory,
  buildExemplarPromptSection,
  createFileTrajectorySink,
  exportSftDataset,
  isGoodTrajectory,
  loadSftDataset,
  measuredNumbers,
  scoreTrajectory,
  scoreTrajectoryGroup,
  selectExemplars,
  trajectoryToSftExample,
  type DiagnosticTrajectory,
  type SftExample,
} from '../agent/learning';
import { buildSyntheticDataset } from '../agent/learning/synthetic';
import { createDiagnosticService } from '../server/diagnosis/service';
import type { DiagnosticTrajectory as ServiceTrajectory } from '../agent/learning';
import type { DiagnosticRequest } from '../server/diagnosis/request';
import type { KnowledgeChunk } from '../server/knowledge/retriever';
import type { DiagnosisMode } from '../shared/diagnosis';

const datasetPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'agent', 'learning', 'data', 'sft-good-trajectories.jsonl');

/** A trajectory that should score well: right topic, tools used, cited reading, asks when info is missing. */
function goodTrajectory(): DiagnosticTrajectory {
  return buildDiagnosticTrajectory({
    id: 'test-good-1',
    createdAt: '2026-11-05T00:00:00.000Z',
    source: 'synthetic-from-existing-cases',
    question: '东方红LF904S拖拉机水温过高报警怎么办',
    machine: { machineType: '拖拉机', brand: '东方红', model: 'LF904S' },
    plannerTopic: 'overheat',
    plannerUsed: true,
    toolCalls: [
      { step: 0, tool: 'search_knowledge', ok: true, errorType: null, durationMs: null, source: '混合资料', evidenceIds: [] },
      { step: 1, tool: 'fault_chain', ok: true, errorType: null, durationMs: null, source: '混合资料', evidenceIds: [] },
    ],
    toolOutputs: [
      { tool: 'search_knowledge', text: '检索到相关条目；水温表读数98°C。' },
      { tool: 'fault_chain', text: '逻辑链：发动机水温过高；原因：冷却液泄漏导致冷却不足。' },
    ],
    evidenceIds: [],
    answer: '东方红LF904S：冷却液泄漏导致冷却不足。水温表读数98°C，该数值来自工具返回。请先确认冷却液泄漏已有检查结果？',
    outcome: 'question',
    route: 'ai',
    reason: 'test',
    usage: { rounds: 2, promptTokens: null, completionTokens: null, totalTokens: null, costUsd: null },
    correctness: 'correct',
  });
}

test('trajectory builder redacts secrets and records missing usage as null, never invented', () => {
  const trajectory = buildDiagnosticTrajectory({
    question: '水温过高怎么办，我的密钥是 sk-abcdefgh12345678，电话 13812345678',
    plannerTopic: 'overheat',
    plannerUsed: true,
    answer: '请联系 test@example.com 确认',
  });
  assert.ok(!trajectory.question.includes('sk-abcdefgh'));
  assert.ok(!trajectory.question.includes('13812345678'));
  assert.ok(!trajectory.answer.includes('test@example.com'));
  assert.equal(trajectory.plannerTopic, 'overheat');
  assert.equal(trajectory.usage.promptTokens, null);
  assert.equal(trajectory.usage.costUsd, null);
  assert.equal(trajectory.correctness, 'unknown');
});

test('measured numbers only count values with units, not model names or evidence IDs', () => {
  assert.deepEqual(measuredNumbers('约翰迪尔 5E 水温 98°C，证据 KB-JD-5E-D0-025'), ['98°C']);
  assert.deepEqual(measuredNumbers('没有数值'), []);
});

test('reward scorer gives a good trajectory total 8 with planner/tool/summary credits split', () => {
  const breakdown = scoreTrajectory(goodTrajectory(), {
    expectedTopic: 'overheat',
    expectedTools: ['search_knowledge', 'fault_chain'],
    expectedCauseText: '冷却液泄漏导致冷却不足',
    infoMissing: true,
  });
  assert.equal(breakdown.planner, 2);
  assert.equal(breakdown.toolUse, 2);
  assert.equal(breakdown.numericCitation, 1);
  assert.equal(breakdown.clarification, 1);
  assert.equal(breakdown.diagnosis, 2);
  assert.equal(breakdown.total, 8);
  assert.deepEqual(breakdown.flags, []);
  assert.deepEqual(breakdown.stepCredits, { planner: 2, tool: 2, summary: 4 });
  assert.equal(isGoodTrajectory(breakdown), true);
});

test('reward scorer penalises each step separately: wrong topic, bypass, fabricated number, hard guess', () => {
  const wrongTopic = scoreTrajectory(goodTrajectory(), { expectedTopic: 'fuel' });
  assert.equal(wrongTopic.planner, -2);
  assert.ok(wrongTopic.flags.includes('planner_wrong_topic'));

  const bypass = buildDiagnosticTrajectory({ question: '水温过高', answer: '就是冷却液泄漏' });
  const bypassScore = scoreTrajectory(bypass, { expectedTopic: 'overheat', expectedTools: ['search_knowledge'] });
  assert.equal(bypassScore.toolUse, -3);
  assert.ok(bypassScore.flags.includes('bypass_tools'));
  assert.equal(isGoodTrajectory(bypassScore), false);

  const fabricated = buildDiagnosticTrajectory({
    question: '水温过高',
    plannerTopic: 'overheat',
    plannerUsed: true,
    toolCalls: [{ step: 0, tool: 'search_knowledge', ok: true, errorType: null, durationMs: null, source: '混合资料', evidenceIds: [] }],
    toolOutputs: [{ tool: 'search_knowledge', text: '水温表读数90°C。' }],
    answer: '水温表读数120°C。',
  });
  const fabricatedScore = scoreTrajectory(fabricated, { expectedTopic: 'overheat', expectedTools: ['search_knowledge'] });
  assert.equal(fabricatedScore.numericCitation, -2);
  assert.ok(fabricatedScore.flags.includes('fabricated_number'));
  assert.equal(isGoodTrajectory(fabricatedScore), false);

  const hardGuess = buildDiagnosticTrajectory({
    question: '水温过高',
    plannerTopic: 'overheat',
    plannerUsed: true,
    answer: '就是冷却液泄漏导致的。',
  });
  const hardGuessScore = scoreTrajectory(hardGuess, { expectedTopic: 'overheat', infoMissing: true });
  assert.equal(hardGuessScore.clarification, -2);
  assert.ok(hardGuessScore.flags.includes('hard_guess'));
});

test('GRPO-style group scoring ranks within the group and returns null best for an empty group', () => {
  const group = scoreTrajectoryGroup('g1', [
    { id: 'a', total: 8 },
    { id: 'b', total: 5 },
    { id: 'c', total: 2 },
  ]);
  assert.equal(group.bestId, 'a');
  assert.equal(group.mean, 5);
  const best = group.scores.find(score => score.id === 'a');
  assert.ok(best && best.advantage > 0);
  const worst = group.scores.find(score => score.id === 'c');
  assert.ok(worst && worst.advantage < 0);
  const advantageSum = group.scores.reduce((sum, score) => sum + score.advantage, 0);
  assert.ok(Math.abs(advantageSum) < 1e-9);
  assert.equal(scoreTrajectoryGroup('empty', []).bestId, null);
});

test('SFT export masks tool outputs: tool turns are train:false and carry no raw tool text', () => {
  const breakdown = scoreTrajectory(goodTrajectory(), {
    expectedTopic: 'overheat',
    expectedTools: ['search_knowledge', 'fault_chain'],
    expectedCauseText: '冷却液泄漏导致冷却不足',
    infoMissing: true,
  });
  const example = trajectoryToSftExample(goodTrajectory(), breakdown.total);
  assert.ok(example);
  const jsonl = exportSftDataset([example!]);
  assert.ok(!jsonl.includes('水温表读数98°C。'));
  assert.ok(!jsonl.includes('检索到相关条目'));
  assert.ok(jsonl.includes('"train":false'));
  const parsed = JSON.parse(jsonl) as SftExample;
  assert.deepEqual(parsed.messages.filter(m => m.role === 'tool').map(m => m.train), [false, false]);
  assert.deepEqual(parsed.messages.filter(m => m.role === 'assistant').map(m => m.train), [true]);
  assert.equal(parsed.rewardTotal, 8);

  const bad: SftExample = {
    id: 'bad-1', topic: null, source: 'test-fixture', rewardTotal: 0,
    messages: [
      { role: 'user', content: 'q', train: true },
      { role: 'tool', name: 'search_knowledge', content: 'raw output', train: true },
      { role: 'assistant', content: 'a', train: true },
    ],
  };
  assert.throws(() => exportSftDataset([bad]), /unmasked tool message/);
});

test('exemplar loader picks the best per topic, caps at 3, and labels the section as examples only', () => {
  const examples = loadSftDataset(datasetPath);
  assert.ok(examples.length >= 50, `expected at least 50 committed examples, got ${examples.length}`);
  const fuel = selectExemplars(examples, { topic: 'fuel' });
  assert.ok(fuel.length > 0 && fuel.length <= 3);
  assert.ok(fuel.every(example => example.topic === 'fuel'));
  assert.ok(fuel.every(example => example.rewardTotal >= 6));
  const section = buildExemplarPromptSection(fuel);
  assert.match(section, /仅作.*参考/);
  assert.match(section, /不作为本次故障的证据/);
  assert.equal(buildExemplarPromptSection([]), '');
});

test('synthetic dataset: 54 candidates from existing cases, 50-100 kept, every kept example passes the gate', () => {
  const result = buildSyntheticDataset();
  assert.equal(result.candidates, 54);
  assert.ok(result.kept >= 50 && result.kept <= 100, `kept ${result.kept}, expected 50-100`);
  assert.equal(result.rejected.length, result.candidates - result.kept);
  assert.deepEqual(Object.keys(result.byTopic).sort(), ['electrical', 'fuel', 'hydraulic', 'overheat', 'starting', 'transmission']);
  for (const example of result.examples) {
    assert.equal(example.source, 'synthetic-from-existing-cases');
    assert.ok(example.rewardTotal >= 6);
    assert.ok(example.messages.some(m => m.role === 'tool' && !m.train));
  }
  const committed = loadSftDataset(datasetPath);
  assert.equal(committed.length, result.kept);
});

test('file sink appends one JSON line per trajectory to a local file only', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agridx-trajectory-'));
  const file = path.join(dir, 'trajectories.jsonl');
  const sink = createFileTrajectorySink(file);
  sink(goodTrajectory());
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal((JSON.parse(lines[0]) as DiagnosticTrajectory).id, 'test-good-1');
});

// --- Diagnosis service integration (same harness shape as tests/diagnosis-decision-log.test.ts) ---

const environmentKeys = ['DIAGNOSIS_MODE', 'ALLOW_EXTERNAL_AI', 'DIAGNOSIS_RAW_HIGH_THRESHOLD', 'DIAGNOSIS_RAW_MEDIUM_THRESHOLD'];
const savedEnvironment = new Map<string, string | undefined>();
beforeEach(() => {
  for (const key of environmentKeys) { savedEnvironment.set(key, process.env[key]); delete process.env[key]; }
});
afterEach(() => {
  for (const key of environmentKeys) {
    const value = savedEnvironment.get(key);
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const identity = { machineType: '拖拉机', brand: '东方红', model: 'LF904S' };
function document(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    source: 'test-fixtures/indicator.md', heading: 'TEST-LEARN-001｜合成水温试验台',
    text: '- 故障现象：合成试验台水温过高。\n- 可能原因：合成冷却状态异常，实际原因尚未确认。\n- 诊断步骤：只核对已有离线观察记录。\n- 维修建议：由试验台维护人员处理。\n- 验证状态：原文已核验；未实车验证。\n末尾限制：测试数据不得用于真实维修。',
    entryId: 'TEST-LEARN-001', sourceId: 'SRC-TEST-LEARN', indexedReference: { entryId: 'TEST-LEARN-001', sourceId: 'SRC-TEST-LEARN' },
    brand: identity.brand, model: identity.model, models: [identity.model], entryType: '维护/故障知识', applicability: 'matched',
    locator: '合成资料PDF第3页；印刷页2', version: '合成测试版1', status: '原文已核验；未厂家复核、未实车验证。',
    scopeBoundary: '仅限合成测试台LF904S；不能用于真实车辆。',
    diagnosticMetadata: { coverage: { symptom: true, causes: true, checks: true, repair: true }, riskLevel: 'low' },
    relevance: { score: 12, method: 'keyword-weighted-overlap', calibrated: false },
    ...overrides,
  } as KnowledgeChunk;
}

function request(): DiagnosticRequest {
  return { ...identity, diagnosisMode: 'auto' as DiagnosisMode, history: [{ role: 'user', content: '水温过高报警怎么办' }] };
}

function harness(options: { onTrajectory?: (t: ServiceTrajectory) => void; trajectoryRecording?: boolean } = {}) {
  const diagnose = createDiagnosticService({
    hasAnyConfigured: () => true,
    chat: async () => ({ result: { content: '合成模型回复；未确诊。', model: 'fixture-model', provider: 'deepseek' }, primary: 'deepseek', fellBack: false, attempts: 1 }),
  }, {
    config: { logDecisions: false },
    onTrajectory: options.onTrajectory,
    trajectoryRecording: options.trajectoryRecording,
    retrieve: () => [document()],
  });
  return diagnose;
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('service emits one trajectory per turn with topic, null usage and unknown correctness', async () => {
  const seen: ServiceTrajectory[] = [];
  const diagnose = harness({ onTrajectory: t => { seen.push(t); } });
  const response = await diagnose(request());
  await flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].source, 'live-diagnosis');
  assert.equal(seen[0].plannerTopic, 'overheat');
  assert.equal(seen[0].question, '水温过高报警怎么办');
  assert.equal(seen[0].usage.promptTokens, null);
  assert.equal(seen[0].usage.costUsd, null);
  assert.equal(seen[0].correctness, 'unknown');
  assert.equal(seen[0].answer, response.choices[0].message.content);
});

test('service trajectory recording does not change the diagnosis answer', async () => {
  const withRecording = await harness({ onTrajectory: () => {} })(request());
  const withoutRecording = await harness({ trajectoryRecording: false })(request());
  assert.equal(withRecording.choices[0].message.content, withoutRecording.choices[0].message.content);
  assert.equal(withRecording.coordination?.route, withoutRecording.coordination?.route);
});

test('service emits nothing when trajectory recording is disabled', async () => {
  const seen: ServiceTrajectory[] = [];
  const diagnose = harness({ trajectoryRecording: false, onTrajectory: t => { seen.push(t); } });
  await diagnose(request());
  await flush();
  assert.equal(seen.length, 0);
});
