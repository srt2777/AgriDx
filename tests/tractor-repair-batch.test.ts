import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';
import { loadArchive } from '../server/knowledge/archive';
import {
  formatForPrompt,
  loadKnowledgeBase,
  retrieve,
  type KnowledgeChunk,
} from '../server/knowledge/retriever';

const indexRoot = '知识库/整理后的知识库/农用拖拉机知识库';
const batchCards = new Map([
  ['约翰迪尔_5E_D0_故障扩充.md', 40],
  ['约翰迪尔_6E国四_故障扩充.md', 35],
  ['中联_PL_故障扩充.md', 25],
]);
const fields = ['故障现象', '可能原因', '诊断步骤', '维修建议', '资料来源', '验证状态'];

interface Entry {
  entry_id: string;
  source_id: string;
  title: string;
  knowledge_path: string;
  locator: string;
  status: string;
  entry_type: string;
}

function cardName(file: string): string {
  return file.split('/').at(-1)!;
}

function getField(text: string, field: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith(`- ${field}：`));
  assert.equal(lines.length, 1, `Exactly one ${field} field is required`);
  const value = lines[0].slice(`- ${field}：`.length).trim();
  assert.ok(value, `${field} must be nonempty`);
  return value;
}

function expectEntry(found: KnowledgeChunk[], entryId: string): KnowledgeChunk {
  const chunk = found.find((item) => item.entryId === entryId);
  assert.ok(chunk, `Expected ${entryId}; received ${found.map((item) => item.entryId).join(', ')}`);
  return chunk;
}

function expectUnverifiedVehicleStatus(status: string, entryId: string): void {
  assert.match(status, /未(?:获|经)?厂家复核/, entryId);
  // Existing cards use either the shared slash notation or two explicit negatives.
  assert.match(status, /未(?:厂家复核\/)?实车验证/, entryId);
  assert.doesNotMatch(status, /实车(?:已验证|验证通过)|厂家(?:已验证|验证通过)/, entryId);
}

const isLearningReference = (chunk: KnowledgeChunk) => chunk.entryType === '通识学习' &&
  chunk.diagnosticEvidence === false && !chunk.indexedReference && chunk.applicability !== 'matched';

before(() => {
  loadKnowledgeBase();
});

test('the 100-entry repair batch has six complete fields and preserves evidence in the model prompt', () => {
  const indexed = fs.readFileSync(`${indexRoot}/entries.jsonl`, 'utf8')
    .trim().split(/\r?\n/).map((line) => JSON.parse(line) as Entry);
  const batch = indexed.filter((entry) => batchCards.has(cardName(entry.knowledge_path)));
  const archive = loadArchive().chunks;
  const chunks = new Map(archive.map((chunk) => [chunk.entryId, chunk]));

  assert.equal(batch.length, 100);
  assert.equal(new Set(indexed.map((entry) => entry.entry_id)).size, indexed.length);
  for (const [name, count] of batchCards) {
    assert.equal(batch.filter((entry) => cardName(entry.knowledge_path) === name).length, count, name);
  }

  for (const entry of batch) {
    const chunk = chunks.get(entry.entry_id);
    assert.ok(chunk, entry.entry_id);
    assert.equal(chunk.heading, `${entry.entry_id}｜${entry.title}`);
    assert.equal(entry.entry_type, '维护/故障知识');
    assert.ok(chunk.text.length < 1200, `${entry.entry_id} exceeds the existing prompt body limit`);
    for (const field of fields) getField(chunk.text, field);

    const source = getField(chunk.text, '资料来源');
    assert.ok(source.includes(entry.source_id), `${entry.entry_id}: source ID missing from body`);
    assert.match(entry.locator, /PDF第\d/);
    assert.match(entry.locator, /印刷/);
    assert.ok(source.includes(entry.locator), `${entry.entry_id}: PDF and printed-page locator differ`);

    const status = getField(chunk.text, '验证状态');
    expectUnverifiedVehicleStatus(status, entry.entry_id);
    expectUnverifiedVehicleStatus(entry.status, entry.entry_id);

    const prompt = formatForPrompt([chunk]);
    assert.ok(prompt.endsWith(chunk.text), `${entry.entry_id}: complete six-field body must survive formatting`);
    for (const value of [entry.source_id, entry.locator, chunk.sourceUrl, chunk.version, chunk.scopeBoundary, entry.status]) {
      assert.ok(value && prompt.includes(value), `${entry.entry_id}: source metadata lost in prompt`);
    }
  }
});

test('6E slow cranking retains its electrical and oil candidates only for documented G4 models', () => {
  const query = '启动电机转动过慢';
  const entryId = 'KB-JD-6E-G4-OMTR115296-049';
  for (const brand of ['约翰迪尔', 'John Deere']) {
    const context = { machineType: '拖拉机', brand, model: '6E-1204(G4)' };
    const chunk = expectEntry(retrieve(query, 100, context), entryId);
    assert.equal(chunk.sourceId, 'SRC-JD-6E-G4-OMTR115296');
    assert.equal(chunk.emissionStage, '国四');
    assert.equal(chunk.applicability, 'matched');
    assert.match(getField(chunk.text, '可能原因'), /电瓶输出电压太低/);
    assert.match(getField(chunk.text, '可能原因'), /曲轴箱机油粘度过稠/);
    assert.match(formatForPrompt([chunk]), /PDF第184页；印刷300-11/);
    assert.ok(retrieve(`国三 ${query}`, 100, context).every(isLearningReference));
  }
  const c2 = retrieve(query, 100, { machineType: '拖拉机', brand: '约翰迪尔', model: '6E-1204' });
  assert.ok(c2.some(chunk => chunk.sourceId === 'SRC-JD-6E-OMSU64123-C2-CN' && chunk.applicability === 'matched'));
  assert.ok(c2.every(chunk => chunk.sourceId === 'SRC-JD-6E-OMSU64123-C2-CN' || isLearningReference(chunk)));
  for (const model of ['6E-1204(G3)', '6E-1204-X(G4)', '6E-1604(G4)']) {
    assert.ok(retrieve(query, 100, { machineType: '拖拉机', brand: '约翰迪尔', model }).every(isLearningReference), model);
  }
});

test('5E front-drive leakage does not expand to the manual\'s two-wheel-drive models', () => {
  const entryId = 'KB-JD-5E-D0-096';
  const query = '前驱动桥中央及最终传动漏油';
  const tractor = { machineType: '拖拉机', brand: '约翰迪尔' };
  // PDF 146 / 400-1 separately lists these six mechanical-front-drive models.
  for (const model of ['5E-854', '5E-904', '5E-954', '5E-1004', '5E-1104', '5E-1204']) {
    const chunk = expectEntry(retrieve(query, 100, { ...tractor, model }), entryId);
    assert.equal(chunk.sourceId, 'SRC-JD-5E-D0-OMSJ34997');
    assert.equal(chunk.requiresExactModel, true);
    assert.equal(chunk.driveConfiguration, '4WD');
    assert.match(chunk.locator!, /PDF第145、146页/);
    assert.ok(retrieve(`国四 ${query}`, 100, { ...tractor, model }).every(isLearningReference), model);
    assert.ok(retrieve(`两驱 ${query}`, 100, { ...tractor, model })
      .every((entry) => entry.entryId !== entryId), model);
  }
  for (const model of ['5E-850', '5E-1000', '5E-1100', '5E-1200']) {
    assert.ok(retrieve(query, 100, { ...tractor, model }).every((entry) => entry.entryId !== entryId), model);
  }
  assert.ok(retrieve(query, 100, tractor).every((entry) => entry.entryId !== entryId));
  assert.ok(retrieve(query, 100, { ...tractor, model: '5E-854-X' }).every(isLearningReference));
});

test('PL charging warning remains a series-level lead and cannot establish an undocumented submodel', () => {
  const query = '发动机运行时发电机报警灯亮';
  const entryId = 'ZL-PL-040';
  const context = { machineType: '拖拉机', brand: '中联', model: 'PL系列' };
  const chunk = expectEntry(retrieve(query, 100, context), entryId);
  assert.equal(chunk.sourceId, 'SRC-ZL-PL-202011');
  assert.equal(chunk.emissionStage, undefined);
  assert.equal(chunk.applicability, 'pending');
  assert.match(getField(chunk.text, '可能原因'), /发动机怠速速度低/);
  assert.match(getField(chunk.text, '可能原因'), /传动皮带断裂或松弛/);
  assert.match(chunk.scopeBoundary!, /子型号/);
  assert.match(chunk.locator!, /PDF第115页；印刷115/);
  for (const model of ['PL2304', 'PL2304(G4)', 'PL1804']) {
    assert.ok(retrieve(query, 100, { ...context, model }).every(isLearningReference), model);
    assert.ok(retrieve(`中联 ${model} ${query}`, 100).every(isLearningReference), model);
  }
  assert.ok(retrieve(`国四 ${query}`, 100, context).every(isLearningReference));
});
