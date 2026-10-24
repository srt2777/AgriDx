import type { GraphCamera } from './graph-interaction';
export interface Position3 { x:number; y:number; z:number }
export function projectEnginePoint(point: Position3, camera: Pick<GraphCamera,'yaw'|'pitch'|'zoom'|'panX'|'panY'>, width:number,height:number,extent:number) {
  const rx=point.x*Math.cos(camera.yaw)+point.z*Math.sin(camera.yaw), rz=-point.x*Math.sin(camera.yaw)+point.z*Math.cos(camera.yaw);
  const ry=point.y*Math.cos(camera.pitch)-rz*Math.sin(camera.pitch), depth=rz*Math.cos(camera.pitch)+point.y*Math.sin(camera.pitch);
  const distance=Math.max(7,extent*3), perspective=distance/Math.max(distance*.3,distance+depth), scale=Math.min(width,height)/(Math.max(2,extent)*2.5)*camera.zoom;
  return {x:width/2+rx*scale*perspective+camera.panX,y:height/2-ry*scale*perspective+camera.panY,depth,scale:scale*perspective};
}
export function focusEnginePoint(camera:GraphCamera,point:Position3,width:number,height:number,extent:number) {
  const target=projectEnginePoint(point,{yaw:camera.targetYaw,pitch:camera.targetPitch,zoom:camera.targetZoom,panX:0,panY:0},width,height,extent);
  camera.targetPanX=width/2-target.x; camera.targetPanY=height/2-target.y; camera.velocityYaw=camera.velocityPitch=0;
}
export function clearGraphFocus(camera:GraphCamera) { camera.targetPanX=camera.targetPanY=0; camera.velocityYaw=camera.velocityPitch=0; }
export interface LabelRequest { id:string; x:number; y:number; width:number; height:number; priority:number; mandatory:boolean }
export interface LabelBox extends LabelRequest { left:number; top:number }
/** Grid-indexed collision checks keep label selection near-linear, even when zoomed in. */
export function placeGraphLabels(requests:LabelRequest[],width:number,height:number):LabelBox[] {
  const cells=new Map<string,LabelBox[]>(), result:LabelBox[]=[];
  const keys=(left:number,top:number,w:number,h:number) => { const out:string[]=[]; for(let x=Math.floor(left/32);x<=Math.floor((left+w)/32);x++)for(let y=Math.floor(top/32);y<=Math.floor((top+h)/32);y++)out.push(`${x}:${y}`); return out; };
  for(const item of [...requests].sort((a,b)=>Number(b.mandatory)-Number(a.mandatory)||a.priority-b.priority)) {
    const w=Math.min(item.width,width-16),h=item.height;
    const candidates=[[item.x+10,item.y-h/2],[item.x-w-10,item.y-h/2],[item.x-w/2,item.y-h-12],[item.x-w/2,item.y+12]];
    if(item.mandatory) for(let y=8;y+h<=height-8;y+=h+6)for(let x=8;x+w<=width-8;x+=w+8)candidates.push([x,y]);
    for(const [left,top] of candidates) {
      if(left<4||top<4||left+w>width-4||top+h>height-4)continue;
      const grid=keys(left-3,top-3,w+6,h+6);
      if(grid.some(key=>(cells.get(key)??[]).some(b=>left<b.left+b.width+3&&left+w+3>b.left&&top<b.top+b.height+3&&top+h+3>b.top)))continue;
      const box={...item,width:w,left,top}; result.push(box);for(const key of grid){if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(box);}break;
    }
  }
  return result;
}
