import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createAgentRoutes } from '../server/routes/agent';
import { createWorkflow } from '../agent/core/workflow';
const prompts = () => ({version:'test',system:'test',flow:'test'});
async function serve(t: { after: (fn:()=>Promise<void>)=>void }, enabled: boolean) {
  const workflow = createWorkflow({prompts,search:()=>({status:'insufficient_evidence',evidence_level:'不足',reason:'缺失',citations:[]})});
  const app = express(); app.use(express.json()); app.use('/api/agent',createAgentRoutes(enabled ? workflow : undefined));
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise<void>(resolve=>{server.close(()=>resolve()); server.closeAllConnections();}));
  const address = server.address(); assert.ok(address && typeof address==='object'); return `http://127.0.0.1:${address.port}/api/agent`;
}
test('开关关闭时状态可发现，运行入口拒绝', async t => {
  const base = await serve(t,false); assert.equal((await (await fetch(base+'/status')).json()).enabled,false);
  assert.equal((await fetch(base+'/run',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
});
test('启用后运行JSON、SSE、校验和同源保护', async t => {
  const base = await serve(t,true); const body=JSON.stringify({query:'启动困难',machine:{}});
  const post=(accept='application/json',origin?:string)=>fetch(base+'/run',{method:'POST',headers:{'Content-Type':'application/json',Accept:accept,...(origin?{Origin:origin}:{})},body});
  const json=await post(); assert.equal(json.status,200); assert.equal((await json.json()).status,'needs_clarification');
  const stream=await post('text/event-stream'); const text=await stream.text(); assert.match(stream.headers.get('content-type')??'',/text\/event-stream/); assert.match(text,/event: status/); assert.match(text,/event: final/);
  assert.equal((await post('application/json','https://untrusted.example')).status,403);
  const invalid=await fetch(base+'/run',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({query:'x',machine:{},confirmed:true})});
  assert.equal(invalid.status,400); assert.match(invalid.headers.get('content-type')??'',/application\/json/);
});
