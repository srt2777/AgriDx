import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fleetChannels,fleetDevices,fleetSummary,fleetSeries} from '../shared/fleet-simulation';
test('fleet points have unique device scope, retain simulated provenance, and do not inflate signal types',()=>{
 assert.deepEqual(fleetSummary,{devices:80,points:1160,signalTypes:29});
 assert.equal(new Set(fleetChannels.map(c=>c.id)).size,1160);
 const devices=new Set(fleetDevices.map(d=>d.id));
 for(const c of fleetChannels){assert.ok(devices.has(c.deviceId));assert.equal(c.source,'simulated');assert.equal(c.threshold,null);}
});
test('selected fleet history is bounded, reproducible and independent per device',()=>{
 const ids=[fleetChannels[0].id,fleetChannels[29].id];const at=1794488400000;
 const result=fleetSeries(ids,'1h',at);assert.deepEqual(result,fleetSeries(ids,'1h',at));
 assert.notDeepEqual(result[0].points.map(p=>p.value),result[1].points.map(p=>p.value));
 for(const row of result){assert.equal(row.points.length,301);assert.equal(row.points[0].at,at-3600000);assert.equal(row.points[300].at,at);for(const p of row.points){assert.equal(p.source,'simulated');assert.equal(p.deviceId,row.channel.deviceId);assert.ok(p.value>=row.channel.range.min&&p.value<=row.channel.range.max);}}
 assert.throws(()=>fleetSeries(['unknown'],'5m',at));assert.throws(()=>fleetSeries(fleetChannels.slice(0,5).map(c=>c.id),'5m',at));
});
