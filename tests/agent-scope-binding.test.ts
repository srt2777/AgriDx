import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent } from '../agent/runner';
import { build_default_registry } from '../agent/default-tools';
import { ToolRegistry } from '../agent/tools';
import type { ChatMessage, Provider } from '../server/llm/types';

const indexTools=['model_fault_index','maintenance_schedule'] as const;
const forged={brand:'别的品牌',model:'OTHER-2',limit:3};

async function runIndices(context?:Record<string,unknown>){
 const received:{name:string;input:unknown}[]=[];
 const registry=new ToolRegistry();
 registry.register('resolve_machine_scope','scope',{type:'object'},()=>({}));
 const defaults=build_default_registry();
 for(const name of indexTools)registry.register({...defaults.get(name)!,func:(input)=>{received.push({name,input});return {entries:[]};}});
 let requests=0;
 let observations:ChatMessage[]=[];
 const provider:Provider={name:'deepseek',model:'test',isConfigured:()=>true,chat:async()=>{throw new Error('unused');},
  chatWithTools:async(messages)=>{
   if(requests++===0)return {content:'',stopReason:'tool_calls',toolCalls:indexTools.map((name,i)=>({id:String(i),name,input:{...forged}}))};
   observations=messages.filter(message=>message.role==='tool');
   return {content:'资料线索仍需核对。',stopReason:'stop',toolCalls:[]};
  }};
 const result=await runAgent({provider,registry,context,messages:[{role:'user',content:'查找当前设备资料'}],query:'查找当前设备资料',
  allowedTools:['resolve_machine_scope',...indexTools],allowExternal:true,guard:text=>text});
 return {received,observations,result};
}

test('model-specific tools replace model-selected identity with the host machine',async()=>{
 const {received,result}=await runIndices({brand:'服务端品牌',model:'TRUSTED-1',engineModel:'ENGINE'});
 assert.equal(result.status,'answered');
 assert.deepEqual(received,indexTools.map(name=>({name,input:{brand:'服务端品牌',model:'TRUSTED-1',limit:3}})));
});

test('partial host scope cannot be completed with a model-invented counterpart',async()=>{
 for(const context of [{brand:'服务端品牌'},{model:'TRUSTED-1'}]){
  const {received,observations,result}=await runIndices(context);
  assert.equal(result.status,'answered');
  assert.deepEqual(received,[]);
  assert.equal(observations.length,2);
  for(const observation of observations)assert.match(observation.content,/ERROR\[INVALID_ARGS\]/);
 }
});

test('standalone model catalogue lookups remain available without a host identity',async()=>{
 for(const context of [undefined,{}, {machineType:'拖拉机'}]){
  const {received,result}=await runIndices(context);
  assert.equal(result.status,'answered');
  assert.deepEqual(received,indexTools.map(name=>({name,input:forged})));
 }
});
