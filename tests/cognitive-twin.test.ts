import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexedDB } from 'fake-indexeddb';
import { OVERHEAT_EVIDENCE, appendEvent, analyzeTwin, twinHandoff, FRESHNESS_MS, type TwinCase, type TwinEvent } from '../shared/cognitive-twin';
import { createTwinCase, saveTwinEvent, listTwinCases, deleteTwinCase } from '../src/features/cognitive-twin/store';
const at = Date.now();
const stamp = new Date(at).toISOString();
function base(id='test'): TwinCase { return { id, revision:0, createdAt:stamp, source:'simulated', profile:{equipmentId:'演示车',model:'T1254B',configurationChecked:true,optionalFan:'unknown'},events:[] }; }
function observation(id='observation'): TwinEvent { return {id,at:stamp,source:'simulated',kind:'observation',temperature:98,note:'合成显示值，不是厂家阈值'}; }
function check(finding: 'supported'|'conflicting'|'unknown'='supported', id='check'): TwinEvent { return {id,at:stamp,source:'simulated',kind:'check',evidenceId:OVERHEAT_EVIDENCE[0].id,finding,note:'合成检查报告'}; }
const observed = () => appendEvent(base(),observation(),0,at);
test('no observations never produces a diagnosis',()=>{assert.equal(analyzeTwin(base(),at).ready,false);});
test('unknown model and unchecked configuration cannot use dedicated evidence',()=>{
 for (const profile of [{...base().profile,model:'未知'},{...base().profile,configurationChecked:false}]) {
  const c=appendEvent({...base(),profile},observation(),0,at); assert.equal(analyzeTwin(c,at).candidates.filter(x=>x.applicable).length,0);
  assert.throws(()=>appendEvent(c,check(),1,at));
 }
});
test('temperature alone does not confirm a cause or assert overheating threshold',()=>{
 const a=analyzeTwin(observed(),at);assert.equal(a.review,undefined);assert.ok(a.candidates.every(x=>x.finding==='unknown'));
});
test('unknown optional fan blocks its dedicated hypothesis',()=>{
 const c=observed(),fan=OVERHEAT_EVIDENCE.find(x=>x.optional)!;
 assert.equal(analyzeTwin(c,at).candidates.find(x=>x.id===fan.id)?.applicable,false);
 assert.throws(()=>appendEvent(c,{...check(),evidenceId:fan.id} as TwinEvent,1,at));
});
test('support and conflict history are retained without deleting hypotheses',()=>{
 const c=appendEvent(appendEvent(observed(),check(),1,at),check('conflicting','check2'),2,at);const a=analyzeTwin(c,at);
 assert.equal(a.candidates.length,11);assert.equal(a.candidates[0].finding,'conflicting');assert.equal(a.candidates[0].hasConflictHistory,true);
 assert.equal(analyzeTwin({...c,events:c.events.slice(0,2),revision:2},at).candidates[0].finding,'supported');
});
test('duplicate event is idempotent and changed duplicate is rejected',()=>{
 const c=observed();assert.equal(appendEvent(c,observation(),0,at),c);assert.throws(()=>appendEvent(c,{...observation(),note:'changed'},1,at));
});
test('stale, future, cross-source and malformed records fail closed',()=>{
 assert.equal(analyzeTwin(observed(),at+FRESHNESS_MS+1).ready,false);
 assert.throws(()=>appendEvent(base(),{...observation(),at:new Date(at+120000).toISOString()},0,at));
 assert.throws(()=>appendEvent(base(),{...observation(),source:'user-reported'},0,at));
 assert.throws(()=>appendEvent(base(),{...observation(),temperature:NaN} as TwinEvent,0,at));
 assert.throws(()=>appendEvent(base(),{...observation(),note:''},0,at));
});
test('review requires supported cause, reviewer and retest; new observation reopens it',()=>{
 const review: TwinEvent={id:'review',at:stamp,source:'simulated',kind:'review',evidenceId:OVERHEAT_EVIDENCE[0].id,reviewer:'测试人员',note:'模拟确认',retest:'模拟复测'};
 assert.throws(()=>appendEvent(observed(),review,1,at));
 const checked=appendEvent(observed(),check(),1,at);
 assert.throws(()=>appendEvent(checked,{...review,retest:''},2,at));
 const c=appendEvent(checked,review,2,at);assert.equal(analyzeTwin(c,at).state,'review_recorded');
 const refreshed=analyzeTwin(appendEvent(c,observation('new'),3,at),at);
 assert.equal(refreshed.state,'check_pending');assert.equal(refreshed.candidates[0].finding,'unknown');
 assert.match(twinHandoff(c),/仿真演示，不是实车读数/);
});
test('evidence projection matches source index; no imported metadata replaces manual scope',()=>{
 const rows=fs.readFileSync('知识库/整理后的知识库/农用拖拉机知识库/entries.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(OVERHEAT_EVIDENCE.length,11);
 for(const item of OVERHEAT_EVIDENCE){const row=rows.find(x=>x.entry_id===item.id);assert.ok(row);assert.equal(row.source_id,item.sourceId);assert.equal(row.locator,item.locator);assert.equal(row.status,item.status);assert.equal(row.title,'发动机过热：'+item.title);}
});
test('browser transactions isolate cases, reject stale writes and cannot resurrect deletion',async()=>{
 Object.assign(globalThis,{indexedDB});
 const c=await createTwinCase(base('storage-a'));await createTwinCase(base('storage-b'));
 const saved=await saveTwinEvent(c.id,observation(),0);assert.equal(saved.revision,1);
 assert.equal((await saveTwinEvent(c.id,observation(),0)).revision,1);
 const results=await Promise.allSettled([saveTwinEvent(c.id,check('supported','concurrent1'),1),saveTwinEvent(c.id,check('unknown','concurrent2'),1)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 let rows=await listTwinCases();assert.equal(rows.find(x=>x.id==='storage-b')!.events.length,0);
 await assert.rejects(deleteTwinCase(c.id,0));await deleteTwinCase(c.id,2);
 await assert.rejects(saveTwinEvent(c.id,check('unknown','late'),2));
 rows=await listTwinCases();assert.equal(rows.some(x=>x.id===c.id),false);
});
