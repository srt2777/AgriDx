import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContextRegistry, knowledgeEntryOutput } from '../agent/context-tools';
import { ToolExecutor, ToolRegistry } from '../agent/tools';
import { MAX_TOOL_OUTPUT } from '../agent/config';
import type { KnowledgeChunk } from '../server/knowledge/types';
import type { SessionDetail } from '../shared/memory';
test('session and reports are bound to the host context and reject model-supplied ownership',async()=>{
 const session={id:'s1',deviceId:'d1',progress:'用户检查一',summary:'用户症状一',revision:1,messages:[],device:{id:'d1',name:'设备一'},title:'test',updatedAt:'2026-01-01'} as SessionDetail;
 const first=new ToolExecutor(buildContextRegistry({session,priorReports:[{sessionId:'prior',updatedAt:'2026-01-01',question:'历史报告一',progress:'待核实'}]}));
 const second=new ToolExecutor(buildContextRegistry());
 assert.match((await first.execute('get_session_state')).content,/用户检查一/);
 assert.match((await first.execute('list_prior_reports')).content,/用户报告，待核实/);
 assert.equal((await first.execute('get_session_state',{deviceId:'d2'})).error_type,'INVALID_ARGS');
 const missingSession=await second.execute('get_session_state');
 assert.equal(missingSession.ok,false);
 assert.equal(missingSession.error_type,'SESSION_UNAVAILABLE');
 const missingReports=await second.execute('list_prior_reports');
 assert.equal(missingReports.ok,false);
 assert.equal(missingReports.error_type,'SESSION_UNAVAILABLE');
 assert.doesNotMatch(missingReports.content,/历史报告一/);
});
test('knowledge entry preserves its provenance and does not assert applicability',async()=>{
 const e=new ToolExecutor(buildContextRegistry());
 const missing=await e.execute('get_knowledge_entry',{entryId:'does-not-exist'});
 assert.equal(missing.ok,false);
 assert.equal(missing.error_type,'NOT_FOUND');
 const absentNode=await e.execute('explore_relations',{nodeId:'does-not-exist'});
 assert.equal(absentNode.ok,false);
 assert.equal(absentNode.error_type,'NOT_FOUND');
});

const entry:KnowledgeChunk={entryId:'KB-TEST-001',source:'fixture.md',heading:'合成测试条目',text:'检查记录。',
 sourceTitle:'合成手册',sourceId:'SRC-TEST-001',sourceUrl:'https://example.invalid/manual',originalPath:'synthetic/manual.pdf',
 locator:'PDF 第 17 页；印刷第 12 页',version:'合成版本',pages:{pdf:'17',printed:'12'},model:'TEST-1',models:['TEST-1'],brand:'测试品牌',
 engineModel:'SYNTHETIC-ENGINE',faultCodes:['SYNTHETIC-CODE'],requiresExactModel:true,configuration:'CAB',
 driveConfiguration:'4WD',emissionStageUnknown:true,roles:['check'],roleBasis:'人工核对',riskLevel:'high',riskBasis:'合成限制',
 scopeBoundary:'只适用于测试型号 TEST-1，配置须另行核对。',status:'待核实',entryType:'操作/维护知识'};

test('long knowledge bodies stay valid JSON and retain complete source and scope metadata',async()=>{
 const longEntry={...entry,text:'🌾"\\\n检查记录。'.repeat(2000)};
 const registry=new ToolRegistry();
 registry.register({...buildContextRegistry().get('get_knowledge_entry')!,func:()=>knowledgeEntryOutput(longEntry)});
 const result=await new ToolExecutor(registry).execute('get_knowledge_entry',{entryId:entry.entryId});
 assert.equal(result.ok,true);
 assert.ok(Array.from(result.content).length<=MAX_TOOL_OUTPUT);
 const output=JSON.parse(result.content);
 assert.equal(output.contentTruncated,true);
 assert.equal(output.contentLength,Array.from(longEntry.text).length);
 assert.ok(output.content.length>0&&output.content.length<longEntry.text.length);
 assert.equal(longEntry.text.startsWith(output.content),true);
 assert.equal(output.content.isWellFormed(),true);
 assert.deepEqual({source:output.source,sourceId:output.sourceId,pages:output.pages,models:output.models,
  brand:output.brand,scopeBoundary:output.scopeBoundary,status:output.status,applicability:output.applicability,sourceType:output.sourceType},
 {source:entry.sourceTitle,sourceId:entry.sourceId,pages:entry.pages,models:entry.models,brand:entry.brand,
  scopeBoundary:entry.scopeBoundary,status:entry.status,applicability:'待核实',sourceType:'归档资料（适用性待核实）'});
 for(const field of ['model','engineModel','faultCodes','requiresExactModel','configuration','driveConfiguration','emissionStageUnknown',
  'locator','version','sourceUrl','originalPath','entryType','roles','roleBasis','riskLevel','riskBasis'] as const){
  assert.deepEqual(output[field],entry[field],`${field} must survive body truncation without alteration`);
 }
});

test('web archives keep single-model and location metadata without becoming manuals',async()=>{
 const result=await new ToolExecutor(buildContextRegistry()).execute('get_knowledge_entry',{entryId:'LV-NR3-001'});
 assert.equal(result.ok,true);
 const output=JSON.parse(result.content);
 assert.equal(output.model,'国三拖拉机');
 assert.equal(output.models,undefined);
 assert.equal(output.emissionStage,'国三');
 assert.equal(output.sourceType,'归档资料（适用性待核实）');
 assert.equal(output.sourceUrl,'https://www.nongjitong.com/company/lovol/tractor_motor_maintain.html');
 assert.ok(output.locator&&output.version);
 assert.equal(output.engineModel,undefined);
 assert.equal(output.faultCodes,undefined);
});

test('terminology entries remain non-diagnostic references without invented manual metadata',async()=>{
 const result=await new ToolExecutor(buildContextRegistry()).execute('get_knowledge_entry',{entryId:'TK-6001'});
 assert.equal(result.ok,true);
 const output=JSON.parse(result.content);
 assert.equal(output.sourceType,'FAO AGROVOC术语参考（无手册页码）');
 assert.equal(output.learningKind,'terminology');
 assert.equal(output.diagnosticEvidence,false);
 assert.equal(output.pages,undefined);
 assert.equal(output.model,undefined);
 assert.equal(output.engineModel,undefined);
 assert.equal(output.faultCodes,undefined);
});

test('short knowledge content is unchanged and general knowledge retains its provenance',()=>{
 const output=JSON.parse(knowledgeEntryOutput({...entry,entryType:'通识学习',pages:undefined}));
 assert.equal(output.content,entry.text);
 assert.equal(output.contentTruncated,false);
 assert.equal(output.sourceType,'通识（无手册页码）');
 assert.equal(output.pages,undefined);
});

test('oversized provenance produces a tool failure instead of unlabelled body text',async()=>{
 const registry=new ToolRegistry();
 registry.register({...buildContextRegistry().get('get_knowledge_entry')!,func:()=>knowledgeEntryOutput({...entry,scopeBoundary:'范围'.repeat(3000)})});
 const result=await new ToolExecutor(registry).execute('get_knowledge_entry',{entryId:entry.entryId});
 assert.equal(result.ok,false);
 assert.equal(result.error_type,'OUTPUT_TOO_LARGE');
 assert.doesNotMatch(result.content,/检查记录/);
});
