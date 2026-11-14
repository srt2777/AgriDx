import { literatureExclusionReason } from '../shared/literature-quality';
import { literatureArchiveEntry } from '../shared/literature-archive';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { getLiterature } from '../server/knowledge/literature';
import { literaturePayloadEncoding, validateLiteratureManifest, validateLiteratureRecord, literatureTokens, literatureBucket, searchLiterature, type LiteratureManifest } from '../shared/literature';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { retrieve, stats } from '../server/knowledge/retriever';

const root=path.resolve('data/literature');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')) as LiteratureManifest;

test('every literature record has verified shard bytes, a unique DOI and an independent non-diagnostic source', () => {
  validateLiteratureManifest(manifest);
  const provenance=JSON.parse(fs.readFileSync(path.join(root,'provenance.json'),'utf8'));
  const sourceHashes=new Set(provenance.map((page: {sha256:string})=>page.sha256));
  const dois=new Set(), ids=new Set(); let count=0;
  for(const shard of manifest.shards) {
    const bytes=fs.readFileSync(path.join(root,shard.file));
    assert.equal(bytes.length,shard.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'),shard.sha256);
    const records=gunzipSync(bytes).toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(records.length,shard.records);
    for(const record of records) {
      const archive=literatureArchiveEntry(record);
      assert.equal(archive.entryId,record.id);assert.deepEqual(archive.knowledgeClaims,[]);
      validateLiteratureRecord(record); assert.equal(literatureExclusionReason(record), null);
      assert.ok(!dois.has(record.doi)); assert.ok(!ids.has(record.id));
      assert.equal(record.id, 'CR-'+createHash('sha256').update(record.doi).digest('hex').slice(0,24));
      assert.ok(sourceHashes.has(record.responseSha256));
      assert.equal(record.diagnosticEvidence,false); assert.equal(record.fullTextVerified,false);
      dois.add(record.doi); ids.add(record.id); count++;
    }
  }
  assert.equal(count,manifest.records);
  assert.equal(Object.values(manifest.search.topics).reduce((a,b)=>a+b,0),count);
});

test('pagination, exact DOI and AND keyword searches resolve actual records; invalid filters fail',async()=>{
  const first=await getLiterature(new URLSearchParams()); assert.equal(first.entries.length,20);
  const second=await getLiterature(new URLSearchParams('page=2'));
  assert.ok(second.entries.every(row=>!first.entries.some(old=>old.id===row.id)));
  const entry=first.entries[0]; const found=await getLiterature(new URLSearchParams({q:entry.doi}));
  assert.equal(found.total,1); assert.equal(found.entries[0].id,entry.id);
  const topic=await getLiterature(new URLSearchParams({topic:entry.topic}));
  assert.ok(topic.entries.every(row=>row.topic===entry.topic));
  assert.equal(topic.total,manifest.search.topics[entry.topic]);
  assert.equal((await getLiterature(new URLSearchParams({q:'zzzznonexistentagrixdrecordzzzz'}))).total,0);
  await assert.rejects(getLiterature(new URLSearchParams('page=-1')),RangeError);
  await assert.rejects(getLiterature(new URLSearchParams('topic=unknown')),RangeError);
  await assert.rejects(getLiterature(new URLSearchParams({q:'x'.repeat(101)})),RangeError);
});

test('new literature cannot silently enter diagnostic evidence or change existing knowledge counts',()=>{
  loadKnowledgeSnapshot();
  assert.deepEqual(stats(),{archivedEntries:6599,learningEntries:6875,totalEntries:13474,chunks:13483});
  for(const query of ['拖拉机发动机启动困难','液压提升无力']) assert.ok(retrieve(query,30).every(chunk=>!chunk.entryId?.startsWith('CR-')));
});

test('manifest traversal, forged diagnostic labels and unsafe source links are rejected',()=>{
  const bad=structuredClone(manifest); bad.shards[0].file='../secrets.json'; assert.throws(()=>validateLiteratureManifest(bad));
  const entry=JSON.parse(gunzipSync(fs.readFileSync(path.join(root,manifest.shards[0].file))).toString('utf8').split('\n')[0]);
  assert.throws(()=>validateLiteratureRecord({...entry,url:'javascript:alert(1)'}));
  assert.throws(()=>validateLiteratureRecord({...entry,diagnosticEvidence:true}));
  assert.throws(()=>validateLiteratureRecord({...entry,fullTextVerified:true}));
});

test('search uses original Unicode tokens and intersects terms before loading document shards',async()=>{
  assert.deepEqual(literatureTokens('Ｓｏｉｌ Soil / 拖拉机'),['soil','拖拉机']);
  let reads=0;
  const result=await searchLiterature(manifest,async file=>{
    reads++; return gunzipSync(fs.readFileSync(path.join(root,file.file))).toString('utf8');
  },new URLSearchParams({q:'nonexistentuniquequeryxyz'}));
  assert.equal(result.total,0); assert.equal(reads,1);
  assert.ok(literatureBucket('soil')>=0 && literatureBucket('soil')<128);
});

test('prototype names and punctuation are not interpreted as index contents', async()=>{
  const empty=await searchLiterature(manifest,async()=> '{}',new URLSearchParams({q:'constructor'}));
  assert.equal(empty.total,0);
  const punctuation=await getLiterature(new URLSearchParams({q:'!!!',topic:Object.keys(manifest.search.topics)[0]}));
  assert.equal(punctuation.total,0);
});

test('published literature paths use the existing gateway asset allowlist',async()=>{
  const {servePreview}=await import('../scripts/dev-preview-gateway/worker.js');
  for(const name of ['manifest.json',manifest.shards[0].file,manifest.search.buckets[0].file]) {
    const response=await servePreview(new Request(`https://example.test/assets/literature/${name}`),async(url: string)=>{
      assert.ok(url.startsWith(`https://raw.githubusercontent.com/srt2777/AgriDx/dev-preview-built/assets/literature/${name}?t=`));
      return new Response(fs.readFileSync(path.join(root,name)));
    });
    assert.equal(response.status,200);
    assert.equal(response.headers.get('Content-Encoding'),null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),fs.readFileSync(path.join(root,name)));
  }
});


test('browser transport accepts verified transparent gzip decoding and rejects altered payloads',()=>{
  const file=manifest.shards[0];
  const wire=fs.readFileSync(path.join(root,file.file)); const decoded=gunzipSync(wire);
  const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(literaturePayloadEncoding(file,wire.length,hash(wire)),'gzip');
  assert.equal(literaturePayloadEncoding(file,decoded.length,hash(decoded)),'identity');
  const altered=Buffer.concat([decoded,Buffer.from('tampered')]);
  assert.throws(()=>literaturePayloadEncoding(file,altered.length,hash(altered)));
});
