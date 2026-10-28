import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStrictSearch } from '../agent/retrieval/strict';
const config=JSON.parse(readFileSync('agent/evals/config.json','utf8')) as {minimum_recall_at_5:number};
const fixture=JSON.parse(readFileSync('agent/evals/cases/title-location.json','utf8')) as {cases:{query:string;machine:{brand:string;model:string};target:string}[]};
test('固定60条真实标题定位集持续保留目标资料召回',()=>{
  const search=createStrictSearch(); let hits=0;
  assert.equal(fixture.cases.length,60);
  for(const item of fixture.cases){const result=search({...item,topK:5});if(result.citations.some(c=>c.chunk_id===item.target))hits++;
    assert.ok(result.citations.every(c=>c.model_match==='exact'&&c.source_id&&c.chunk_id));
  }
  assert.ok(hits/fixture.cases.length>=config.minimum_recall_at_5,`标题定位 Recall@5 ${hits}/${fixture.cases.length}`);
});
