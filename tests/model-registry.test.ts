import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import meta from '../config/model-registry.json';
test('public model archive counts and provenance match retained source and unique records',()=>{
 const bytes=readFileSync('public/assets/model-registry/records.json');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),meta.recordsSha256);
 assert.equal(createHash('sha256').update(readFileSync('public/assets/model-registry/jiangsu-2025-3.xls')).digest('hex'),meta.sourceSha256);
 const rows=JSON.parse(bytes.toString()) as {id:string;manufacturer:string;model:string;category:string;rows:number[]}[];
 assert.equal(rows.length,meta.models);assert.ok(rows.length>=1000);assert.equal(meta.diagnosticEvidence,false);
 assert.equal(new Set(rows.map(r=>JSON.stringify([r.manufacturer,r.model]))).size,rows.length);
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
 const sourceRows=rows.flatMap(r=>r.rows);assert.equal(sourceRows.length,meta.rawRows);assert.equal(new Set(sourceRows).size,meta.rawRows);assert.equal(Math.min(...sourceRows),2);assert.equal(Math.max(...sourceRows),3308);
 assert.equal(new Set(rows.map(r=>r.manufacturer)).size,meta.manufacturers);assert.equal(new Set(rows.map(r=>r.category)).size,meta.categories);
});
