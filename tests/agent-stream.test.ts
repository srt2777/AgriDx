import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkflowStream } from '../src/features/chat/agent-api';
const result={status:'needs_clarification',content:'请补充机型',safety:['先停机'],citations:[],questions:[],trace:{events:[]}};
function response(text: string) {
  const encoded=new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=3)controller.enqueue(encoded.slice(i,i+3));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}
test('SSE流能重组跨字节中文和跨帧JSON',async()=>{
  const events: unknown[]=[];
  const stream=response(`event: status\ndata: {"type":"tool_start","tool":"search"}\n\nevent: final\ndata: ${JSON.stringify(result)}\n\n`);
  assert.equal((await readWorkflowStream(stream,e=>events.push(e))).content,'请补充机型'); assert.equal(events.length,1);
});
test('缺少最终事件或响应异常时不能显示成功',async()=>{
  await assert.rejects(readWorkflowStream(response('event: status\ndata: {"type":"done"}\n\n'),()=>{}),/未收到完整结果/);
  await assert.rejects(readWorkflowStream(new Response(JSON.stringify({error:'服务繁忙'}),{status:429}),()=>{}),/服务繁忙/);
  await assert.rejects(readWorkflowStream(response('event: final\ndata: {}\n\n'),()=>{}),/格式错误/);
});
test('表单空白可选机型字段在发送前省略',async()=>{
  const {requestWorkflow}=await import('../src/features/chat/agent-api');
  const previous=globalThis.fetch;let body: unknown;
  globalThis.fetch=async (_url,options)=>{body=JSON.parse(String(options?.body));return response(`event: final\ndata: ${JSON.stringify(result)}\n\n`);};
  try{await requestWorkflow({query:'启动困难',machine:{brand:' 久保田 ',model:'LX2620',engineModel:''}},new AbortController().signal,()=>{});
    assert.deepEqual((body as {machine:unknown}).machine,{brand:'久保田',model:'LX2620'});
  }finally{globalThis.fetch=previous;}
});
