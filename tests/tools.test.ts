import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, ToolExecutor, build_default_registry } from '../agent/tools';
const schema = {type:'object',properties:{value:{type:'integer',enum:[1,2,3]}},required:['value'],additionalProperties:false} as const;
function setup() { const r=new ToolRegistry(); r.register('double','测试',schema,({value})=>({result:value*2})); return {r,e:new ToolExecutor(r)}; }
test('strings, objects, decorator and schemas',async()=>{
 const {r,e}=setup(); assert.equal((await e.execute('double',{value:2})).content,'{"result":4}');
 r.tool('echo','测试',{type:'object'})(()=> '中文'); assert.equal((await e.execute('echo')).content,'中文');
 assert.deepEqual(r.schemas(['echo']).map(t=>t.name),['echo']); assert.match(r.describe(),/double/);
 const s=r.schemas(); s[0].input_schema.type='string'; assert.equal(r.get('double')!.input_schema.type,'object');
});
test('unknown and detailed invalid arguments',async()=>{
 const {e}=setup(); assert.match((await e.execute('missing')).content,/UNKNOWN_TOOL.*double/);
 for(const args of [{},{value:'two'},{value:4},{value:1,extra:2}]) { const result=await e.execute('double',args); assert.equal(result.error_type,'INVALID_ARGS'); assert.match(result.content,/value|extra/); }
});
test('exceptions and cyclic output never escape; bigint uses string fallback',async()=>{
 const {r,e}=setup(); r.register('fail','测试',{type:'object'},()=>{throw new TypeError('bad input');});
 assert.match((await e.execute('fail')).content,/ERROR\[TOOL_ERROR\]: TypeError: bad input/);
 const cycle:any={}; cycle.self=cycle; r.register('cycle','测试',{type:'object'},()=>cycle); assert.equal((await e.execute('cycle')).error_type,'TOOL_ERROR');
 r.register('big','测试',{type:'object'},()=>1n); assert.equal((await e.execute('big')).content,'"1"');
});
test('timeout returns promptly',async()=>{const {r,e}=setup(); r.register({name:'slow',description:'测试',input_schema:{type:'object'},timeout_s:.01,func:()=>new Promise(resolve=>setTimeout(resolve,80))}); assert.equal((await e.execute('slow')).error_type,'TIMEOUT');});
test('unicode output truncation reports original length',async()=>{const {r,e}=setup();r.register({name:'long',description:'测试',input_schema:{type:'object'},max_output:5,func:()=> '🌾'.repeat(10)});assert.equal((await e.execute('long')).content,'🌾'.repeat(5)+'...[已截断,原长 10 字符,请缩小查询范围]');});
test('canonical repetition and task isolation',async()=>{const {e,r}=setup();await e.execute('double',{value:1});await e.execute('double',{value:1});assert.equal((await e.execute('double',{value:1})).error_type,'REPEATED_CALL');assert.ok((await new ToolExecutor(r).execute('double',{value:1})).ok);});
test('permissions default and explicit confirmation, callback exceptions',async()=>{const {r,e}=setup();r.register({name:'delete',description:'测试',input_schema:{type:'object'},risk:'dangerous',func:()=> 'done'}); assert.equal((await e.execute('delete')).error_type,'PERMISSION_DENIED');assert.ok((await new ToolExecutor(r,()=>true).execute('delete')).ok);assert.equal((await new ToolExecutor(r,()=>{throw new Error('confirmation failed');}).execute('delete')).error_type,'TOOL_ERROR');r.register({name:'save',description:'测试',input_schema:{type:'object'},risk:'write',func:()=> 'saved'});assert.ok((await e.execute('save')).ok);assert.equal((await new ToolExecutor(r,()=>false).execute('save')).error_type,'PERMISSION_DENIED');});
test('batch reads parallel, bounded to four, writes serial, output ordered',async()=>{
 const r=new ToolRegistry(); let active=0,max=0;const events:string[]=[];
 r.register('read','测试',{type:'object'},async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,10));active--;return 'read';});
 r.register({name:'write',description:'测试',input_schema:{type:'object'},risk:'write',func:async()=>{assert.equal(active,0);events.push('write');return 'write';}});
 const e=new ToolExecutor(r);const blocks=[...Array.from({length:6},(_,i)=>({type:'tool_use',id:String(i),name:'read',input:{i}})),{type:'text',text:'x'},{type:'tool_use',id:'w',name:'write',input:{}},{type:'tool_use',id:'bad',name:'missing',input:{}}];
 const results=await e.execute_tool_uses(blocks); assert.equal(max,4);assert.deepEqual(events,['write']);assert.deepEqual(results.map(r=>r.tool_use_id),['0','1','2','3','4','5','w','bad']);assert.equal(results.at(-1)!.is_error,true);assert.ok(!('is_error' in results[0]));
});
test('trace recursively redacts credentials',async()=>{const {r,e}=setup();r.register('trace','测试',{type:'object'},()=> 'ok');await e.execute('trace',{apiKey:'abc',nested:{password:'p',items:[{token:'t'}]}});assert.deepEqual(e.trace[0].args,{apiKey:'***',nested:{password:'***',items:[{token:'***'}]}});});
test('registration rejects duplicate, invalid names and schemas',()=>{const {r}=setup();assert.throws(()=>r.register('double','测试',{type:'object'},()=>0));for(const name of ['','bad name','x'.repeat(65)])assert.throws(()=>r.register(name,'测试',{type:'object'},()=>0));for(const s of [{type:'string'},{type:'object',properties:{x:{type:'invalid'}}},{type:'object',minimum:'x'}])assert.throws(()=>r.register('bad','测试',s as any,()=>0));});
test('calculator safely parses arithmetic and refuses code',async()=>{const r=build_default_registry();assert.equal(r.names().length,6);const e=new ToolExecutor(r);assert.equal((await e.execute('calculator',{expression:'(12 + 3) * 2 % 7'})).content,'2');for(const expression of ["__import__('os')",'process.exit()','1/0','2**3'])assert.equal((await e.execute('calculator',{expression})).error_type,'TOOL_ERROR');});
test('default adapters preserve knowledge sources and scope',async()=>{const r=build_default_registry();const e=new ToolExecutor(r);assert.ok(JSON.parse((await e.execute('knowledge_stats')).content).archivedEntries>0);assert.ok(JSON.parse((await e.execute('resolve_machine_scope',{query:'东方红LF1504启动困难',context:{brand:'久保田',model:'LX2620'}})).content).identityConflict);assert.match((await e.execute('search_knowledge',{query:'久保田LX2620启动困难',limit:1})).content,/source/);assert.match((await e.execute('browse_knowledge',{brand:'久保田',model:'LX2620',limit:1})).content,/久保田/);assert.equal(JSON.parse((await e.execute('get_current_time')).content).timezone,'Asia/Shanghai');});
