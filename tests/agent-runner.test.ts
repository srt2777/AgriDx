import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../agent/runner';
import { ToolRegistry } from '../agent/tools';
import type { Provider, ToolChatOptions, ToolChatResult } from '../server/llm/types';
function setup(replies:ToolChatResult[]){const registry=new ToolRegistry();registry.register('resolve_machine_scope','scope',{type:'object'},()=>({brand:'test'}));registry.register('read','read',{type:'object'},()=>({source:'manual',value:4}));let n=0;const seen:ToolChatOptions[]=[];const provider:Provider={name:'deepseek',model:'fake',isConfigured:()=>true,chat:async()=>{throw Error('unused');},chatWithTools:async (_messages,options)=>{seen.push(options);return replies[n++]!;}};return {registry,provider,seen};}
const call:ToolChatResult={content:'',stopReason:'tool_calls',toolCalls:[{id:'a',name:'read',input:{}}]};
const answer:ToolChatResult={content:'supported answer',stopReason:'stop',toolCalls:[]};
const common={messages:[{role:'user' as const,content:'question'}],query:'question',allowedTools:['resolve_machine_scope','read'],allowExternal:true,guard:(s:string)=>s};
test('runner reads actual tool results and forces final response at budget',async()=>{const env=setup([call,answer]);const result=await runAgent({...common,...env,maxSteps:2});assert.equal(result.status,'answered');assert.deepEqual(result.toolEvents.map(e=>e.tool),['resolve_machine_scope','read']);assert.equal(env.seen[1].toolChoice,'none');});
test('runner falls back for unsupported providers, disallowed calls and rejected answers',async()=>{const env=setup([{...call,toolCalls:[{...call.toolCalls[0],name:'forbidden'}]}]);assert.equal((await runAgent({...common,...env})).status,'fallback');const bad=setup([answer]);const result=await runAgent({...common,...bad,guard:()=>null});assert.equal(result.status,'fallback');assert.equal(result.reason,'answer_rejected');const unsupported=setup([]);delete unsupported.provider.chatWithTools;assert.equal((await runAgent({...common,...unsupported})).reason,'provider_unavailable');});
test('runner returns when a provider ignores the wall-clock deadline',async()=>{const env=setup([]);env.provider.chatWithTools=()=>new Promise(()=>{});const result=await runAgent({...common,...env,timeoutMs:10});assert.equal(result.status,'fallback');assert.equal(result.reason,'deadline');});
test('runner cancellation does not start further calls',async()=>{const env=setup([]),controller=new AbortController();env.provider.chatWithTools=()=>new Promise(()=>{});const pending=runAgent({...common,...env,signal:controller.signal});setTimeout(()=>controller.abort(),5);const result=await pending;assert.equal(result.status,'cancelled');});
test('trusted coordination blocks external calls and model cannot override device context',async()=>{
 const env=setup([]);let received:unknown;env.registry.register('search_knowledge','search',{type:'object'},(input)=>{received=input;return 'ok';});let n=0;env.provider.chatWithTools=async()=>n++===0?{content:'',stopReason:'tool_calls',toolCalls:[{id:'x',name:'search_knowledge',input:{query:'q',context:{brand:'forged'}}}]}:answer;
 const denied=await runAgent({...common,...env,allowExternal:false});assert.equal(denied.reason,'coordination_denied');assert.equal(n,0);
 const result=await runAgent({...common,...env,allowedTools:['resolve_machine_scope','search_knowledge'],context:{brand:'trusted'}});assert.equal(result.status,'answered');assert.deepEqual(received,{query:'q',context:{brand:'trusted'}});assert.ok(!JSON.stringify(result.toolEvents).includes('trusted'));assert.ok(!JSON.stringify(result.toolEvents).includes('question'));
});
test('ask-user control ends the run and never executes accompanying tools',async()=>{
 const env=setup([{content:'',stopReason:'tool_calls',toolCalls:[{id:'q',name:'ask_user_for_info',input:{question:'请确认型号？'}}]}]);env.registry.register('ask_user_for_info','question',{type:'object',properties:{question:{type:'string'}},required:['question'],additionalProperties:false},({question})=>({question}));
 const result=await runAgent({...common,...env,allowedTools:['resolve_machine_scope','ask_user_for_info']});assert.equal(result.status,'question');assert.equal(env.seen.length,1);
});
test('repeated failed calls are rejected and their actual error is sent to the next step',async()=>{
 const env=setup([]);let seenError=false,n=0;env.registry.register('fail','fail',{type:'object'},()=>{throw new Error('synthetic failure');});
 env.provider.chatWithTools=async(messages)=>{seenError ||= messages.some(message=>message.role==='tool'&&message.content.includes('TOOL_ERROR'));return n++<3?{content:'',stopReason:'tool_calls',toolCalls:[{id:`f${n}`,name:'fail',input:{}}]}:answer;};
 const result=await runAgent({...common,...env,allowedTools:['resolve_machine_scope','fail'],maxSteps:5});assert.equal(result.status,'answered');assert.equal(seenError,true);assert.equal(result.toolEvents.at(-1)?.error_type,'REPEATED_CALL');
});
test('provider failures and exhausted steps return a safe fallback',async()=>{
 const failed=setup([]);failed.provider.chatWithTools=async()=>{throw Error('synthetic');};assert.equal((await runAgent({...common,...failed})).reason,'provider_or_tool_error');
 const exhausted=setup([call]);const result=await runAgent({...common,...exhausted,maxSteps:1});assert.equal(result.status,'fallback');assert.equal(result.reason,'disallowed_or_excess_tools');
});
