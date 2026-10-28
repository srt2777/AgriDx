import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BM25Index, normalizeQuery, fuseRankings } from '../agent/retrieval/lexical';
const a={source:'a',heading:'启动困难',text:'发动机无法启动 起动机',entryId:'A',model:'M1'};
const b={source:'b',heading:'液压泄漏',text:'提升系统油管泄漏',entryId:'B',model:'M2'};
test('BM25依据查询排名并在排名前过滤机型',()=>{
  const index=new BM25Index([a,b]);
  assert.equal(index.search('启动',()=>true)[0].chunk.entryId,'A');
  assert.deepEqual(index.search('液压',c=>c.model==='M1'),[]);
});
test('同义词仅归一现象，RRF保留多通道共同命中',()=>{
  assert.equal(normalizeQuery('打不着',[{canonical:'启动困难',aliases:['打不着']}]),'打不着 启动困难');
  const ranking=fuseRankings([[{chunk:a,score:100},{chunk:b,score:1}],[{chunk:b,score:0.1}]]);
  assert.equal(ranking[0].chunk.entryId,'B'); assert.equal(ranking.length,2);
});
