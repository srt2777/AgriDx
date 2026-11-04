import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, mapObservations, parseWorkbench, observationStats, datasetCsv, MAX_ROWS } from '../src/features/workbench/data';

test('CSV handles BOM, quoted commas, quotes and multiline fields', () => {
  assert.deepEqual(parseCsv('\uFEFFtime,value,note\r\n0,0,"a,b"\r\n1,-2,"a""b\nc"'), [['time','value','note'],['0','0','a,b'],['1','-2','a"b\nc']]);
});
test('CSV rejects ambiguous headers, malformed quotes and inconsistent rows', () => {
  for (const csv of ['a,a\n1,2', 'a,b\n1', 'a,b\n1,"x', 'a,b\n1,"x"y']) assert.throws(() => parseCsv(csv));
  assert.throws(() => parseCsv('a,b\n' + '1,2\n'.repeat(MAX_ROWS + 1)));
});
test('mapping preserves zero and negative observations, normalizes timestamps and sorts', () => {
  assert.deepEqual(mapObservations(parseCsv('t,v\n2,-1\n0,0'),0,1,'seconds'), [{at:0,value:0},{at:2000,value:-1}]);
  assert.equal(mapObservations(parseCsv('t,v\n2026-11-04T12:00:00+08:00,2'),0,1,'iso')[0].at, Date.parse('2026-11-04T04:00:00Z'));
});
test('mapping rejects duplicate times, missing values, invalid numbers and timezone ambiguity', () => {
  for (const csv of ['t,v\n0,2\n0,3', 't,v\n0,', 't,v\n0,Infinity']) assert.throws(() => mapObservations(parseCsv(csv),0,1,'seconds'));
  assert.throws(() => mapObservations(parseCsv('t,v\n2026-11-04T12:00:00,1'),0,1,'iso'));
  assert.throws(() => mapObservations(parseCsv('t,v\n0,1'),0,0,'seconds'));
});
const dataset = {id:'test',name:'Observation',unit:'rpm',object:'=HYPERLINK("example")',source:'user-import' as const,createdAt:1,points:[{at:0,value:-2},{at:1,value:0}]};
test('local persistence never upgrades user observations to verified telemetry', () => {
  assert.deepEqual(parseWorkbench({datasets:[dataset],activities:[]}).datasets,[dataset]);
  for (const invalid of [{...dataset,source:'verified'}, {...dataset,points:[{at:0,value:NaN}]}, {...dataset,points:[{at:1,value:1},{at:0,value:2}]}]) assert.equal(parseWorkbench({datasets:[invalid]}).datasets.length,0);
  assert.deepEqual(parseWorkbench(null),{datasets:[],activities:[]});
});
test('export keeps negative numbers numeric and escapes formula-like metadata with provenance', () => {
  const csv=datasetCsv(dataset);
  assert.match(csv, /,-2,/); assert.match(csv, /"'=HYPERLINK/); assert.match(csv,/user-import/);
});
test('statistics use every raw sample and avoid overflowing ordinary large means', () => {
  assert.deepEqual(observationStats(dataset.points),{min:-2,max:0,mean:-1,count:2});
  assert.equal(observationStats([]),null);
  assert.equal(observationStats([{at:0,value:1e308},{at:1,value:1e308}])?.mean,1e308);
});
