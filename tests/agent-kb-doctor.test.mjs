import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectKnowledge } from '../scripts/kb-doctor.mjs';

test('体检识别重复条目、缺失来源和孤立来源', () => {
  const report = inspectKnowledge([{ entry_id: 'E1', source_id: 'S1' }, { entry_id: 'E1', source_id: 'missing' }], [{ source_id: 'S1' }, { source_id: 'orphan' }]);
  assert.deepEqual(report.duplicateEntryIds, ['E1']);
  assert.deepEqual(report.missingSources, ['missing']);
  assert.deepEqual(report.orphanSourceIds, ['orphan']);
  assert.equal(report.missing.brand, 2);
});
