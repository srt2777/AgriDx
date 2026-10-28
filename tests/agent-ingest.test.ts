import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument, updateIndex, type StagedDocument } from '../agent/ingest/index';
const doc: StagedDocument = { metadata: { doc_id: 'd', version: '1', source: 'SAMPLE', doc_type: 'manual', brand: 'A', model: 'M' }, text: '# 故障\n| 码 | 原因 |\n| --- | --- |\n| X | 未知 |\n# 检查\n核对' };
test('按标题分块且表格保持完整', () => { const chunks = chunkDocument(doc); assert.equal(chunks.length, 2); assert.match(chunks[0].text, /\| X \| 未知 \|/); });
test('增量更新只重建变化文档，识别移除和重复', () => {
  const first = updateIndex({ documents: {} }, [doc]);
  const second = updateIndex(first.index, [doc]); assert.deepEqual(second.changed, []);
  assert.equal(Object.values(second.index.documents)[0], Object.values(first.index.documents)[0]);
  assert.equal(updateIndex(second.index, [{ ...doc, text: '变化' }]).changed.length, 1);
  assert.equal(updateIndex(second.index, []).removed.length, 1);
  assert.throws(() => updateIndex(second.index, [doc, doc]));
});
test('超长章节拒绝而不截断表格', () => assert.throws(() => chunkDocument(doc, 10)));
