import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getKnowledgeCatalog } from '../server/knowledge/catalog';
import { buildKnowledgeRelations, pageKnowledgeRelations } from '../server/knowledge/relations';
import { semanticRelations } from '../server/knowledge/relations-semantic';
import { membershipStrength, componentStrength } from '../shared/relation-strength';
import { parseKnowledgeRelations } from '../src/features/knowledge/relations-api';
import { readSemanticReport } from '../scripts/lib/semantic-report.mjs';

test('heuristic membership and shared components remain bounded and deterministic', () => {
  assert.equal(membershipStrength(20,0),0); assert.equal(membershipStrength(0,0),0);
  const roles={symptom:2,cause:1,check:1,action:0,retest:0,tagged:2,untagged:0};
  assert.ok(componentStrength(4,5,roles,roles,.2,.3) <= .2);
  const data=buildKnowledgeRelations(getKnowledgeCatalog());
  assert.equal(data.nodes.length, 5636); assert.ok(data.edges.every(e=>Number.isFinite(e.strength) && e.strength>=0 && e.strength<=1));
  assert.ok(!data.nodes.some(id=>id.includes('千寻位置')));
  assert.ok(data.edges.filter(e=>e.type==='membership' && e.evidence.childCount===0).every(e=>e.strength===0));
  assert.deepEqual(buildKnowledgeRelations(getKnowledgeCatalog()),data);
  const bytes=Buffer.byteLength(JSON.stringify(data)); console.log(`[relations] ${data.nodes.length} nodes, ${data.edges.length} edges, ${bytes} bytes uncompressed`);
  assert.equal(parseKnowledgeRelations(data,new Set(data.nodes)),data);
  const page=pageKnowledgeRelations(data,new URLSearchParams('offset=100&limit=200'));
  assert.deepEqual(page.edges,data.edges.slice(100,300)); assert.equal(page.page?.total,data.edges.length);
  assert.equal(parseKnowledgeRelations(page,new Set(data.nodes)),page);
  assert.throws(()=>pageKnowledgeRelations(data,new URLSearchParams('limit=10001')),/分页/);
});
test('client rejects invalid nodes, duplicates and unsafe strength', () => {
  const value={kbVersion:null,formulaVersion:'1.0.0',nodes:['a','b'],edges:[{from:'a',to:'b',type:'membership',strength:.5,basis:'目录',evidence:{count:1}}],degraded:[],limitations:['仅资料关联']};
  const ids=new Set(['a','b']);
  assert.equal(parseKnowledgeRelations(value,ids),value);
  for(const bad of [NaN,Infinity,-.1,1.1]) assert.throws(()=>parseKnowledgeRelations({...value,edges:[{...value.edges[0],strength:bad}]},ids));
  assert.throws(()=>parseKnowledgeRelations({...value,edges:[value.edges[0],value.edges[0]]},ids));
  assert.throws(()=>parseKnowledgeRelations({...value,nodes:['a','c']},ids));
});
test('semantic candidates require a matching complete snapshot and stay pending', () => {
  const sha='a'.repeat(64), report={schema_version:1,snapshot:{sha256:sha},relations:[{relation_id:'KR-1',relation:'complementary',review_state:'pending',left_entry_id:'e1',right_entry_id:'e2'}]};
  const entryNodes=new Map([['e1',['a']],['e2',['b']]]), ids=new Set(['a','b']);
  const yes=semanticRelations({report,snapshotSha256:sha,entryNodes},ids);
  assert.equal(yes.edges.length,1);assert.equal(yes.edges[0].evidence.reviewState,'pending');
  assert.ok(semanticRelations({report,snapshotSha256:'b'.repeat(64),entryNodes},ids).degraded.length);
  assert.ok(semanticRelations({report:{...report,example:{omitted_relations:1}},snapshotSha256:sha,entryNodes},ids).degraded.length);
  assert.ok(semanticRelations({},ids).degraded.length);
});
test('audited report loader rejects stale content and excludes raw files from output', () => {
  const root=mkdtempSync(path.join(tmpdir(),'relations-audit-'));
  const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
  try {
    const base='知识库/整理后的知识库/农用拖拉机知识库'; mkdirSync(path.join(root,base),{recursive:true});mkdirSync(path.join(root,'docs'),{recursive:true});
    const source='[]', body='manual body', entry=JSON.stringify({knowledge_path:`${base}/card.md`})+'\n';
    const files:Record<string,string>={ [`${base}/sources.json`]:hash(source), [`${base}/entries.jsonl`]:hash(entry), [`${base}/card.md`]:hash(body) };
    for(const [name,content] of [[`${base}/sources.json`,source],[`${base}/entries.jsonl`,entry],[`${base}/card.md`,body]]) writeFileSync(path.join(root,name),content);
    const sorted=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0));
    const report={schema_version:1,blocked:false,review_state:'pending',summary:{candidates:0},snapshot:{sha256:hash(JSON.stringify(sorted)),files},relations:[]};
    writeFileSync(path.join(root,'docs/knowledge-semantic-report.json'),JSON.stringify(report));
    const result=readSemanticReport(root);assert.ok(result.report);assert.ok(!JSON.stringify(result).includes('manual body'));
    writeFileSync(path.join(root,`${base}/card.md`),'changed');assert.match(readSemanticReport(root).reason!,/不一致/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});
