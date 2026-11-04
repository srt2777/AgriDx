import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fraction, histogram, timeCells, timelineBounds } from '../src/features/workbench/analytics';
import { loadTelemetryDemoConfig, telemetryCatalog, simulateTelemetry } from '../server/telemetry/simulator';

test('normalization is bounded for signed extreme values and constant series',()=>{
 assert.equal(fraction(0,-1e308,1e308),.5); assert.equal(fraction(4,4,4),.5); assert.equal(fraction(-20,0,10),0); assert.equal(fraction(20,0,10),1);
});
test('histogram conserves every observation including the upper edge and constant values',()=>{
 const points=[-2,-1,0,1,2].map((value,at)=>({at,value})); const bins=histogram(points,4);
 assert.equal(bins.reduce((sum,b)=>sum+b.count,0),5);assert.equal(bins.at(-1)?.count,2);
 assert.deepEqual(histogram([{at:0,value:3},{at:1,value:3}]),[{low:3,high:3,count:2}]);assert.deepEqual(histogram([]),[]);
});
test('time cells retain gaps and compute raw means without carrying values forward',()=>{
 const cells=timeCells([{at:0,value:2},{at:1,value:4},{at:40,value:8}],0,40,4);
 assert.deepEqual(cells.map(c=>c.value),[3,null,null,8]); assert.equal(cells.reduce((s,c)=>s+c.count,0),3);
});
test('replay range covers every selected channel rather than the first only',()=>{
 assert.deepEqual(timelineBounds([{points:[{at:10,value:1}]},{points:[{at:5,value:1},{at:20,value:2}]},{points:[]}]),{from:5,to:20}); assert.equal(timelineBounds([]),null);
});
test('new demo channels survive public catalog and deterministic sampling without manufacturer thresholds',()=>{
 const config=loadTelemetryDemoConfig(),catalog=telemetryCatalog(config);
 const first=simulateTelemetry(config,{elapsedMs:15000}), next=simulateTelemetry(config,{elapsedMs:35000});
 assert.deepEqual(first,simulateTelemetry(config,{elapsedMs:15000}));
 for(const id of ['diesel.rear-axle.speed','diesel.fuel-tank.consumption','diesel.hydraulic-lift.pressure','diesel.engine.load','t70.battery-box.soc','t70.battery-box.current','t70.battery-box.power','diesel.engine.vibration']) {
  const channel=catalog.channels.find(c=>c.id===id)!;assert.ok(channel);assert.equal(channel.source,'simulated');assert.equal(channel.threshold,null);
  const value=first.points.find(p=>p.channelId===id)!.value;assert.ok(value>=channel.range.min&&value<=channel.range.max);assert.notEqual(value,next.points.find(p=>p.channelId===id)!.value);
 }
});
