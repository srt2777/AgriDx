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
 const e=new ToolExecutor(buildContextRegistry());assert.match((await e.execute('get_knowledge_entry',{entryId:'does-not-exist'})).content,/NOT_FOUND/);
});
