import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGraphCamera, stepGraphCamera, cameraMoving, graphNeighborhood } from '../src/pages/KnowledgePage/graph-interaction';
import { createGraphGestures, selectGraphHit } from '../src/pages/KnowledgePage/graph-gestures';
import { projectEnginePoint, focusEnginePoint, placeGraphLabels } from '../src/pages/KnowledgePage/graph-visuals';
import { catalogNetwork, brandCenters, modelOffsets } from '../src/pages/KnowledgePage/knowledge-engine-model';
import type { TaxonomyNode } from '../src/pages/KnowledgePage/knowledge-taxonomy-data';
const node=(id:string,parent?:string,level:TaxonomyNode['level']='brand'):TaxonomyNode=>({id,parent,level,label:id,count:0,order:0,query:{brand:parent??id}});

test('selection focuses the projected target smoothly, preserving zoom, with reduced motion snapping',()=>{
  const camera=createGraphCamera();camera.zoom=camera.targetZoom=2.4;
  const point={x:3,y:-2,z:1};const before=projectEnginePoint(point,camera,900,620,8);
  focusEnginePoint(camera,point,900,620,8);
  assert.equal(camera.targetZoom,2.4);assert.equal(camera.panX,0);assert.ok(cameraMoving(camera));
  stepGraphCamera(camera,1/30);const halfway=projectEnginePoint(point,camera,900,620,8);
  assert.ok(Math.hypot(halfway.x-450,halfway.y-310)<Math.hypot(before.x-450,before.y-310));
  for(let i=0;i<90;i++)stepGraphCamera(camera,1/30);
  const after=projectEnginePoint(point,camera,900,620,8);assert.ok(Math.abs(after.x-450)<.01&&Math.abs(after.y-310)<.01);
  focusEnginePoint(camera,{x:-2,y:1,z:0},375,460,8);stepGraphCamera(camera,0,true);
  const mobile=projectEnginePoint({x:-2,y:1,z:0},camera,375,460,8);assert.ok(Math.abs(mobile.x-187.5)<.001);assert.equal(camera.zoom,2.4);
});
test('mandatory labels survive crowded anchors without overlapping at desktop and 375px',()=>{
  for(const width of [375,1200]) {
    const requests=Array.from({length:25},(_,i)=>({id:String(i),x:width/2,y:240,width:100,height:22,priority:i,mandatory:true}));
    const boxes=placeGraphLabels(requests,width,600);assert.equal(boxes.length,requests.length);
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j];assert.ok(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top);
    }
    assert.deepEqual(placeGraphLabels(requests,width,600),boxes);
  }
  const boxes=placeGraphLabels([{id:'active',x:30,y:30,width:100,height:22,priority:0,mandatory:true},...Array.from({length:300},(_,i)=>({id:`other-${i}`,x:30,y:30,width:100,height:22,priority:1,mandatory:false}))],375,460);
  assert.equal(boxes[0].id,'active');assert.ok(boxes.length<10);
});
test('brand counts above twelve have independent deterministic centers and separated model clusters',()=>{
  for(const count of [0,1,12,13,40]) {
    const centers=brandCenters(count,3);assert.equal(centers.length,count);assert.deepEqual(brandCenters(count,3),centers);
    for(let i=0;i<count;i++)for(let j=i+1;j<count;j++)assert.ok(Math.hypot(centers[i].x-centers[j].x,centers[i].y-centers[j].y,centers[i].z-centers[j].z)>6);
  }
  const offsets=modelOffsets(120);assert.equal(offsets.length,120);
  for(let i=0;i<offsets.length;i++)for(let j=i+1;j<offsets.length;j++)assert.ok(Math.hypot(offsets[i].x-offsets[j].x,offsets[i].y-offsets[j].y,offsets[i].z-offsets[j].z)>1.19);
  const nodes=Array.from({length:15},(_,i)=>node(`brand${i}`));nodes.push(node('model','brand13','model'),node('component','model','component'),node('part','component','part'));
  const original=structuredClone(nodes),network=catalogNetwork(nodes,['#123456','#abcdef']);assert.deepEqual(catalogNetwork(nodes,['#123456','#abcdef']),network);assert.deepEqual(nodes,original);
  assert.equal(network.nodes[0].color,'#123456');assert.equal(network.nodes[15].color,'#abcdef');assert.equal(network.nodes[17].count,0);
  assert.deepEqual(network.edges.map(e=>[network.nodes[e.from].id,network.nodes[e.to].id]),[['brand13','model'],['model','component'],['component','part']]);
  const group=graphNeighborhood(nodes,'component',Infinity);assert.deepEqual(group.shown.map(n=>n.id),['brand13','model','component','part']);
});
test('shared gestures support rotation, panning while pinching and never click after a pinch or cancel',()=>{
  const c=createGraphCamera(),g=createGraphGestures(c);g.down({pointerId:1,x:0,y:0});g.move({pointerId:1,x:20,y:10});assert.ok(c.targetYaw>-.13);assert.equal(g.up({pointerId:1,x:20,y:10}),null);
  g.down({pointerId:1,x:-50,y:0});g.down({pointerId:2,x:50,y:0});
  g.move({pointerId:1,x:-60,y:10});g.move({pointerId:2,x:80,y:10});assert.ok(c.targetZoom>1);assert.ok(c.targetPanY>0);
  assert.equal(g.up({pointerId:1,x:-60,y:10}),null);assert.equal(g.up({pointerId:2,x:80,y:10}),null);
  g.down({pointerId:1,x:0,y:0});g.cancel(1);assert.equal(g.up({pointerId:1,x:0,y:0}),null);
  g.down({pointerId:1,x:0,y:0});assert.deepEqual(g.up({pointerId:1,x:0,y:0}),{x:0,y:0});
  g.down({pointerId:1,x:0,y:0});g.move({pointerId:1,x:15,y:0});g.up({pointerId:1,x:15,y:0},true);assert.equal(c.velocityYaw,0);
  g.down({pointerId:9,x:0,y:0});g.reset();assert.equal(g.active(),false);assert.equal(g.up({pointerId:9,x:0,y:0}),null);
  g.wheel(-100,0,{x:0,y:0});assert.ok(c.targetZoom>1);g.doubleClick({x:0,y:0});assert.ok(c.targetZoom>1.8);
});
test('blank clicks clear selection and repeated hits do not reselect or destroy state',()=>{
  const calls:string[]=[];const select=(id:string)=>calls.push(id);
  assert.equal(selectGraphHit('model','model',select),'model');assert.deepEqual(calls,[]);
  assert.equal(selectGraphHit('model',undefined,select),'');assert.deepEqual(calls,['']);
  selectGraphHit('',undefined,select);assert.deepEqual(calls,['']);selectGraphHit('','part',select);assert.deepEqual(calls,['','part']);
});
