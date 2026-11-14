import { MAX_TOOL_OUTPUT } from '../agent/config';
import { loadKnowledgeBase } from '../server/knowledge/retriever';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import type { SessionDetail } from '../shared/memory';
test('session and reports are bound to the host context and reject model-supplied ownership',async()=>{
 const session={id:'s1',deviceId:'d1',progress:'用户检查一',summary:'用户症状一',revision:1,messages:[],device:{id:'d1',name:'设备一'},title:'test',updatedAt:'2026-01-01'} as SessionDetail;
 const first=new ToolExecutor(buildContextRegistry({session,priorReports:[{sessionId:'prior',updatedAt:'2026-01-01',question:'历史报告一',progress:'待核实'}]}));
 const second=new ToolExecutor(buildContextRegistry());
 assert.match((await first.execute('get_session_state')).content,/用户检查一/);
 assert.match((await first.execute('list_prior_reports')).content,/用户报告，待核实/);
 assert.equal((await first.execute('get_session_state',{deviceId:'d2'})).error_type,'INVALID_ARGS');
 assert.match((await second.execute('get_session_state')).content,/SESSION_UNAVAILABLE/);
 assert.doesNotMatch((await second.execute('list_prior_reports')).content,/历史报告一/);
});
test('knowledge entry preserves its provenance and does not assert applicability',async()=>{
 const e=new ToolExecutor(buildContextRegistry());
 assert.match((await e.execute('get_knowledge_entry',{entryId:'does-not-exist'})).content,/NOT_FOUND/);
 const result = JSON.parse((await e.execute('get_knowledge_entry', { entryId: 'KB-JD-TM901519-001' })).content);
 assert.equal(result.sourceType, '资料索引');
 assert.equal(result.entryType, '资料索引');
 assert.equal(result.sourceId, 'SRC-JD-TM901519-FT4-2019');
 assert.equal(result.applicability, '待核实');
});

test('knowledge search fits complete citations into the tool output budget', async () => {
  loadKnowledgeBase();
  const executor = new ToolExecutor(buildContextRegistry());
  const question = { query: '发动机难以起动', context: { brand: '东方红', model: 'LF804S' } };
  const one = await executor.execute('search_knowledge', { ...question, limit: 1 });
  const response = await executor.execute('search_knowledge', { ...question, limit: 5 });
  assert.equal(response.ok, true);
  assert.ok(Array.from(response.content).length <= MAX_TOOL_OUTPUT);
  const full = JSON.parse(response.content);
  const first = JSON.parse(one.content);
  assert.ok(full.omittedEntries > 0);
  assert.equal(full.chunks.length + full.omittedEntries, 5);
  assert.deepEqual(full.chunks[0], first.chunks[0]);
  assert.ok(full.chunks[0].sourceId && full.chunks[0].locator && full.chunks[0].text);
});
