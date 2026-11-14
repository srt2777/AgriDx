import fs from 'node:fs';
import { loadKnowledgeSnapshot } from '../server/knowledge/snapshot';
import { researchKnowledge } from '../shared/research-knowledge';
const snapshot = loadKnowledgeSnapshot();
const rows = snapshot.chunks.filter(row => row.entryId);
const seen = new Set<string>();
const issues: {id:string;reason:string}[] = [];
const types: Record<string,number> = {};
for(const row of rows) {
  const id=row.entryId!;
  if(seen.has(id)) issues.push({id,reason:'duplicate-id'});
  seen.add(id);
  types[row.entryType??'unknown']=(types[row.entryType??'unknown']??0)+1;
  if(!row.text.trim()) issues.push({id,reason:'empty-body'});
  if(/通知公告|补贴.*(?:审核|公示|通过产品)|征稿通知/.test(row.heading)) issues.push({id,reason:'notice-title'});
}
for(const entry of researchKnowledge.entries) {
  if(!entry.claim.trim() || !entry.locator.trim() || !researchKnowledge.sources.some(source=>source.id===entry.sourceId)) issues.push({id:entry.entryId,reason:'missing-research-evidence'});
}
const report={scanned:rows.length+researchKnowledge.entries.length,archive:snapshot.archivedEntries,learning:rows.length-snapshot.archivedEntries,research:researchKnowledge.entries.length,types,issues,scope:'All local indexed bodies checked for missing content, duplicate IDs and notice titles. Not an expert review or live-link/full-text verification. Metadata/navigation entries remain provenance, not repair instructions.'};
fs.writeFileSync('data/research-knowledge/content-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(issues.length) process.exitCode=1;
