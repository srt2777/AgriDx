// Migrated from ec364b8:tests/retrieval-tiers.test.ts; source files stay read-only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { referenceVerification } from '../server/knowledge/evidence';
import { loadKnowledgeBase, retrieve } from '../server/knowledge/retriever';
import { loadKnowledgeSnapshot, reloadKnowledgeSnapshot } from '../server/knowledge/snapshot';

const lf = { machineType: '拖拉机', brand: '东方红', model: 'LF1504' };
const lfSource = 'SRC-YTO-LF1504-SMLF150449010';
before(() => loadKnowledgeBase());

test('failed highest-ranked references are removed before top-k selection', t => {
  const query = '东方红 LF1504 起动机不转';
  const originalFirst = retrieve(query, 1, lf)[0];
  assert.ok(originalFirst?.entryId && originalFirst.sourceId === lfSource);
  const entriesPath = path.resolve('知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl');
  const read = fs.readFileSync;
  const mock = t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof fs.readFileSync>) => {
    const data = read(...args);
    if (String(args[0]) !== entriesPath) return data;
    return String(data).split(/\r?\n/).map(line => {
      if (!line.trim()) return line;
      const entry = JSON.parse(line) as { entry_id: string; status: string };
      return entry.entry_id === originalFirst.entryId
        ? JSON.stringify({ ...entry, status: '核验失败；已核验' }) : line;
    }).join('\n');
  });
  t.after(() => { mock.mock.restore(); reloadKnowledgeSnapshot(); });
  reloadKnowledgeSnapshot();
  assert.equal(referenceVerification(loadKnowledgeSnapshot().chunks.find(chunk => chunk.entryId === originalFirst.entryId)!.status), 'failed');
  const found = retrieve(query, 1, lf);
  assert.equal(found.length, 1, 'an admissible candidate should fill the vacated slot');
  assert.notEqual(found[0].entryId, originalFirst.entryId);
  assert.ok(found.every(chunk => referenceVerification(chunk.status) !== 'failed'));
});
