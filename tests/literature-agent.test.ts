import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getLiterature } from '../server/knowledge/literature';
import { literatureArchiveEntry, literatureChatReply, literatureQuery } from '../shared/literature-archive';
import { researchKnowledge, researchKnowledgeReply } from '../shared/research-knowledge';
import { buildContextRegistry } from '../agent/context-tools';
import { ToolExecutor } from '../agent/tools';
import { createDiagnosticService } from '../server/diagnosis/service';
import { parseChatResponse, requestChatStream } from '../src/features/chat/api';

test('archive citation preserves actual DOI and provenance, never promotes metadata to knowledge claims', async()=>{
 const page=await getLiterature(new URLSearchParams({q:'10.1006/jaer.1993.1001'}));
 assert.equal(page.total,1);const entry=literatureArchiveEntry(page.entries[0]);
 assert.equal(entry.citation.doi,'10.1006/jaer.1993.1001');assert.deepEqual(entry.knowledgeClaims,[]);
 assert.equal(entry.diagnosticEvidence,false);assert.equal(entry.fullTextVerified,false);
 assert.equal(entry.provenance.responseSha256,page.entries[0].responseSha256);
 const reply=await literatureChatReply('查文献：10.1006/jaer.1993.1001',getLiterature);
 assert.equal(reply?.knowledgeSources.length,1);assert.match(reply!.choices[0].message.content,/全文/);
 assert.equal(parseChatResponse(reply).knowledgeSources?.[0].evidenceKind,'literature');
});
test('explicit lookup is served by actual chat service without model calls or diagnostic evidence',async()=>{
 const service=createDiagnosticService({hasAnyConfigured:()=>false,chat:async()=>{throw new Error('must not call model');}}, {literatureSearch:getLiterature});
 const reply=await service({history:[{role:'user',content:'查文献：tractor'}]});
 assert.equal(reply.model,'literature-archive');assert.match(reply.choices[0].message.content,/483/);
 assert.ok(reply.knowledgeSources.every(s=>s.usage==='reference-only'&&s.diagnosticEvidence===false));
 const research=await service({history:[{role:'user',content:'查知识条目：RK-GEAR-002'}]});
 assert.match(research.choices[0].message.content,/96.70%/);assert.match(research.choices[0].message.content,/98.89%/);
});
test('ordinary diagnostic questions do not bypass diagnosis for literature search',()=>{
 assert.equal(literatureQuery('拖拉机液压故障怎么维修'),undefined);
 assert.equal(literatureQuery('论文说制动坏了怎么办'),undefined);
 assert.equal(researchKnowledgeReply('液压压力不足怎么办'),undefined);
 assert.equal(literatureQuery('查文献：拖拉机'),'tractor');
});
test('missing archive never invents sources and cancellation is preserved',async()=>{
 const failure=await literatureChatReply('查文献：tractor',async()=>{throw new Error('offline');});
 assert.equal(failure?.knowledgeSources.length,0);assert.match(failure!.choices[0].message.content,/未取得可引用来源/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(literatureChatReply('查文献：tractor',getLiterature,controller.signal));
});
test('agent tools use bounded host storage and reject arbitrary URLs',async()=>{
 const executor=new ToolExecutor(buildContextRegistry(undefined,getLiterature));
 const result=await executor.execute('search_literature',{query:'10.1006/jaer.1993.1001'});
 assert.equal(result.ok,true);const payload=JSON.parse(result.content);assert.equal(payload.entries[0].entryType,'文献归档');
 assert.equal(payload.entries[0].diagnosticEvidence,false);
 assert.equal((await executor.execute('search_literature',{url:'http://localhost/secret'})).error_type,'INVALID_ARGS');
 const research=await executor.execute('search_research_knowledge',{query:'齿轮箱'});
 assert.equal(research.ok,true);assert.match(research.content,/正文研究结果/);
});
test('every research entry has a source, location, excerpt hash, scope and conservative evidence status',()=>{
 assert.equal(researchKnowledge.entries.length,7);
 assert.equal(new Set(researchKnowledge.entries.map(e=>e.entryId)).size,7);
 for(const entry of researchKnowledge.entries){
  assert.ok(researchKnowledge.sources.some(s=>s.id===entry.sourceId&&s.fullTextRead));
  assert.ok(entry.locator);assert.ok(entry.scopeBoundary);assert.equal(entry.diagnosticEvidence,false);
  assert.equal(entry.expertReviewed,false);assert.equal(createHash('sha256').update(entry.evidenceExcerpt).digest('hex'),entry.excerptSha256);
 }
 assert.ok(researchKnowledge.sources.every(s=>!s.journal.includes('中国农机化')));
});

test('static-preview streaming chat uses local citation handler when no fetch override is supplied', async()=>{
 const scope=globalThis as unknown as Record<string,unknown>;
 const original=scope.__AGRIDX_DEV_PREVIEW__; scope.__AGRIDX_DEV_PREVIEW__=true;
 try {
  const reply=await requestChatStream({messages:[{role:'user',content:'查知识条目：RK-GEAR-002'}]},new AbortController().signal,'unavailable',()=>{});
  assert.equal(reply.model,'research-knowledge');assert.match(reply.content,/96.70%/);
 } finally { if(original===undefined)delete scope.__AGRIDX_DEV_PREVIEW__; else scope.__AGRIDX_DEV_PREVIEW__=original; }
});
