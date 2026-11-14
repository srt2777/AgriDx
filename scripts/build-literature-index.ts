import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { literatureTokens, literatureBucket, validateLiteratureRecord } from '../shared/literature';
import { literatureExclusionReason } from '../shared/literature-quality';
const filter = process.argv.includes('--quality-filter');
const excluded: {id:string; doi:string; reason:string}[] = [];
const reasons: Record<string,number> = {};
let scanned = 0;
const root = path.resolve('data/literature');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const sourceShards = manifest.shards;
const buckets: Record<string, number[]>[] = Array.from({length:128}, () => Object.create(null));
const topics: Record<string, number> = Object.create(null);
const journalCounts: Record<string, number> = Object.create(null);
let minYear = Infinity, maxYear = -Infinity;
const output = path.join(root, '.indexed'); fs.mkdirSync(output, {recursive:true});
const shards: {file:string; records:number; sha256:string; contentSha256:string; bytes:number}[] = [];
let pending: string[] = [], count = 0;
const seen = new Set<string>();
function write(file: string, text: string) {
  const bytes = gzipSync(text, {level:9}); fs.writeFileSync(path.join(output,file), bytes);
  return {file, sha256:createHash('sha256').update(bytes).digest('hex'), contentSha256:createHash('sha256').update(text).digest('hex'), bytes:bytes.length};
}
function flush() {
  if (pending.length) shards.push({...write(`records-${String(shards.length+1).padStart(3,'0')}.jsonl.gz`,pending.join('\n')+'\n'),records:pending.length});
  pending=[];
}
for (const shard of sourceShards) {
  const compressed = fs.readFileSync(path.join(root,shard.file));
  if (createHash('sha256').update(compressed).digest('hex') !== shard.sha256) throw new Error('Source hash mismatch');
  for (const line of gunzipSync(compressed).toString('utf8').trim().split('\n')) {
    const record = JSON.parse(line); validateLiteratureRecord(record);
    scanned++;
    const reason = filter ? literatureExclusionReason(record) : null;
    if (reason) { excluded.push({id:record.id,doi:record.doi,reason}); reasons[reason]=(reasons[reason]??0)+1; continue; }
    if(seen.has(record.doi)) throw new Error('Duplicate DOI'); seen.add(record.doi);
    for(const token of literatureTokens([record.title,record.journal,record.doi,...record.authors].join(' '))) {
      (buckets[literatureBucket(token)][token] ??= []).push(count);
    }
    const doiToken = `\0doi:${record.doi}`;
    buckets[literatureBucket(doiToken)][doiToken] = [count];
    const topicToken = `\0topic:${record.topic}`;
    (buckets[literatureBucket(topicToken)][topicToken] ??= []).push(count++);
    journalCounts[record.sourceIssn] = (journalCounts[record.sourceIssn] ?? 0) + 1;
    minYear = Math.min(minYear, record.published[0]); maxYear = Math.max(maxYear, record.published[0]);
    topics[record.topic] = (topics[record.topic] ?? 0) + 1; pending.push(line);
    if (pending.length===1000) flush();
  }
}
flush(); if(scanned !== manifest.records) throw new Error('Count mismatch');
const files = buckets.map((bucket,i)=>write(`terms-${String(i).padStart(3,'0')}.json.gz`,JSON.stringify(bucket)));
for (const shard of sourceShards) fs.unlinkSync(path.join(root,shard.file));
for (const file of fs.readdirSync(output)) fs.renameSync(path.join(output,file),path.join(root,file));
fs.rmdirSync(output);
if(filter) {
  const audit = {policy:'machinery-discovery-v1',scanned,retained:count,excluded:excluded.length,reasons,fullTextReviewed:false,notes:'Full local metadata scan; retained records are discovery candidates, not verified knowledge. Exclusions are reversible through Git history.'};
  fs.writeFileSync(path.join(root,'quality-audit.json'),JSON.stringify(audit,null,2)+'\n');
  fs.writeFileSync(path.join(root,'quality-exclusions.jsonl.gz'),gzipSync(excluded.map(r=>JSON.stringify(r)).join('\n')+'\n',{level:9}));
  manifest.records=count; delete manifest.target; delete manifest.complete; manifest.qualityPolicy=audit.policy;
}
manifest.shards=shards; manifest.search={shardSize:1000,buckets:files,topics};
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest)+'\n');
const statisticsPath = path.join(root,'statistics.json');
const statistics = JSON.parse(fs.readFileSync(statisticsPath,'utf8'));
delete statistics.totalIndexedRecords;
Object.assign(statistics, {literatureRecords:count, literatureIncludedInKnowledgeTotal:false, topics, journalCounts, publicationYearRange:count ? [minYear,maxYear] : []});
fs.writeFileSync(statisticsPath,JSON.stringify(statistics,null,2)+'\n');
console.log(JSON.stringify({records:count,shards:shards.length,searchBuckets:128}));
