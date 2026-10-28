import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatibleProvider } from '../server/llm/openai-compatible';
import { ProviderError } from '../server/llm/types';

test('OpenAI-compatible tool calls encode schemas and decode structured inputs without exposing upstream data',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.TEST_TOOL_PROVIDER_KEY;process.env.TEST_TOOL_PROVIDER_KEY='synthetic-test-key';let request:Record<string,any>|undefined;
 try{
  globalThis.fetch=async (_url,init)=>{request=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'calculator',arguments:'{"expression":"2+2"}'}}]}}]}),{status:200});};
  const provider=createOpenAICompatibleProvider({name:'deepseek',model:'test',apiUrl:'https://example.invalid/chat',apiKeyEnv:'TEST_TOOL_PROVIDER_KEY'});
  assert.ok(provider.chatWithTools);const result=await provider.chatWithTools([{role:'user',content:'2+2'}],{tools:[{name:'calculator',description:'arithmetic',input_schema:{type:'object'}}]});
  assert.deepEqual(result,{content:'',toolCalls:[{id:'call-1',name:'calculator',input:{expression:'2+2'}}],stopReason:'tool_calls'});assert.equal(request?.tools[0].function.name,'calculator');assert.equal(request?.tool_choice,'auto');
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'call-1',type:'function',function:{name:'calculator',arguments:'not-json'}}]}}]}));
  await assert.rejects(provider.chatWithTools([{role:'user',content:'x'}],{tools:[]}),error=>error instanceof ProviderError&&error.kind==='invalid_response');
  const gemini=createOpenAICompatibleProvider({name:'gemini',model:'test',apiUrl:'https://example.invalid/chat',apiKeyEnv:'TEST_TOOL_PROVIDER_KEY'});assert.equal(gemini.chatWithTools,undefined);
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.TEST_TOOL_PROVIDER_KEY;else process.env.TEST_TOOL_PROVIDER_KEY=oldKey;}
});

test('caller cancellation aborts an in-flight tool request and is distinguished from timeout',async()=>{
 const oldFetch=globalThis.fetch,oldKey=process.env.TEST_TOOL_PROVIDER_KEY;process.env.TEST_TOOL_PROVIDER_KEY='synthetic-test-key';
 try{
  globalThis.fetch=async (_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
  const provider=createOpenAICompatibleProvider({name:'deepseek',model:'test',apiUrl:'https://example.invalid/chat',apiKeyEnv:'TEST_TOOL_PROVIDER_KEY'});const controller=new AbortController();
  const pending=provider.chatWithTools!([{role:'user',content:'x'}],{tools:[],signal:controller.signal});controller.abort();await assert.rejects(pending,error=>error instanceof ProviderError&&error.kind==='cancelled');
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.TEST_TOOL_PROVIDER_KEY;else process.env.TEST_TOOL_PROVIDER_KEY=oldKey;}
});
