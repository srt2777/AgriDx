import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainLayout } from '../src/pages/KnowledgePage/knowledge-terrain-layout';
import { terrainField } from '../src/pages/KnowledgePage/knowledge-terrain-field';
import { terrainContours } from '../src/pages/KnowledgePage/knowledge-terrain-contours';
import { terrainCacheKey } from '../src/pages/KnowledgePage/knowledge-terrain-cache';
import { terrainMemberships } from '../src/pages/KnowledgePage/knowledge-terrain-fallback';
import type { TaxonomyNode } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
const sample:TaxonomyNode[]=[{id:'brand',label:'A',level:'brand',order:0,count:10,query:{brand:'A'}},{id:'model',label:'B',level:'model',parent:'brand',order:0,count:2,query:{brand:'A',model:'B'}},{id:'gap',label:'C',level:'component',parent:'model',order:0,count:0,query:{brand:'A',model:'B'}}];
test('terrain layout is stable and retains all identities',()=>{const a=terrainLayout(sample);assert.deepEqual(a,terrainLayout(sample));assert.equal(a.length,3);assert.ok(a.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));});
test('zero count makes no peak and contours have bounded levels',()=>{const empty=terrainField(terrainLayout([{...sample[0],count:0}]),[],48,36);assert.ok(empty.values.every(v=>v===0));const field=terrainField(terrainLayout(sample),[],48,36);assert.ok(field.values.some(v=>v>0));const lines=terrainContours(field,12);assert.ok(lines.every(s=>s.level>0&&s.level<1&&[...s.a,...s.b].every(n=>Number.isFinite(n)&&n>=0&&n<=1)));});
test('stronger associations produce a steeper ridge',()=>{
  const points=[{id:'a',x:.2,y:.5,count:1,brand:'a',level:'brand' as const,label:'A'},{id:'b',x:.8,y:.5,count:1,brand:'a',level:'model' as const,label:'B'}];
  const gradient=(strength:number)=>{const field=terrainField(points,[{from:'a',to:'b',type:'membership',strength,basis:'catalog',evidence:{}}],201,201);let maximum=0;for(let y=0;y<200;y++)maximum=Math.max(maximum,Math.abs(field.values[y*201+100]-field.values[(y+1)*201+100]));return maximum;};
  assert.ok(gradient(.9)>gradient(.3));
});
test('contours around a contained peak close at every level',()=>{
  const points=[{id:'a',x:.5,y:.5,count:1,brand:'a',level:'brand' as const,label:'A'}];
  const lines=terrainContours(terrainField(points,[],101,101),12);
  assert.equal(new Set(lines.map(line=>line.level)).size,12);
  for(const level of new Set(lines.map(line=>line.level))){const degree=new Map<string,number>();for(const line of lines.filter(line=>line.level===level)){for(const p of [line.a,line.b]){const key=p.map(value=>value.toFixed(7)).join(',');degree.set(key,(degree.get(key)??0)+1);}}assert.ok([...degree.values()].every(value=>value===2));}
});
test('cache key invalidates on snapshot, filtering, counts and fallback',()=>{
  const key=(version:string,warning:string,nodes:TaxonomyNode[])=>terrainCacheKey(version,warning,48,36,nodes,[]);
  const base=key('v1','',sample);
  assert.notEqual(base,key('v2','',sample));
  assert.notEqual(base,key('v1','fallback',sample));
  assert.notEqual(base,key('v1','',sample.slice(0,2)));
  assert.notEqual(base,key('v1','',[{...sample[0],count:11},...sample.slice(1)]));
});
test('fallback retains only evidenced catalog membership, including zero-entry gaps',()=>{
  const edges=terrainMemberships(sample);
  assert.equal(edges.length,2);
  assert.ok(edges.every(edge=>edge.type==='membership'));
  assert.deepEqual(edges.find(edge=>edge.to==='gap')?.evidence,{parentCount:2,childCount:0});
  assert.equal(edges.find(edge=>edge.to==='gap')?.strength,0);
  assert.deepEqual(terrainMemberships(sample.slice(1)),[edges[1]]);
});
