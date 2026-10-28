import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStrictSearch } from '../agent/retrieval/strict';
import type { KnowledgeChunk } from '../server/knowledge/types';
import type { retrieve } from '../server/knowledge/retriever';

const chunk = { source: 'manual.md', heading: 'KB-TEST-001｜故障码', text: '原文', entryId: 'KB-TEST-001', sourceId: 'SRC-TEST-001', indexedReference: { entryId: 'KB-TEST-001', sourceId: 'SRC-TEST-001' }, applicability: 'matched', retrieval: { tier: 'exact', referenceOnly: false, basis: [] }, status: '已核验', faultCodes: ['P001'] } as KnowledgeChunk;
test('缺机型不触发检索', () => {
  let calls = 0;
  const search = createStrictSearch((() => { calls++; return []; }) as typeof retrieve, () => {});
  assert.equal(search({ query: '启动困难', machine: {} }).status, 'identity_required');
  assert.equal(calls, 0);
});
test('故障码必须与结构化故障码完全匹配', () => {
  const search = createStrictSearch((() => [chunk]) as typeof retrieve, () => {});
  assert.equal(search({ query: '报码', machine: { brand: '甲', model: 'M1' }, faultCode: 'P002' }).citations.length, 0);
});
test('参考资料和未核验资料不升级为证据', () => {
  const search = createStrictSearch((() => [{ ...chunk, applicability: 'pending' }, { ...chunk, diagnosticEvidence: false }]) as typeof retrieve, () => {});
  assert.equal(search({ query: '报码', machine: { brand: '甲', model: 'M1' } }).status, 'insufficient_evidence');
});

test('已核验且机型和代码匹配的证据可返回', () => {
  const search = createStrictSearch((() => [chunk]) as typeof retrieve, () => {});
  assert.equal(search({ query: '报码', machine: { brand: '甲', model: 'M1' }, faultCode: 'P001' }).citations.length, 1);
});
