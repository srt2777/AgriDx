import { zoomGraph, type GraphCamera } from './graph-interaction';
export interface GesturePoint { x: number; y: number }
export interface GestureInput extends GesturePoint { pointerId: number; shiftKey?: boolean; button?: number; timeStamp?:number }
/** DOM-free shared gesture state. A pinch remains a gesture after either finger lifts. */
export function createGraphGestures(camera: GraphCamera) {
  const pointers = new Map<number, GesturePoint>();
  let start = { x: 0, y: 0 }, last = start, moved = false, pinched = false, pan = false, lastTime=0, vx=0, vy=0;
  const midpoint = () => { const [a,b] = [...pointers.values()]; return { x: (a.x+b.x)/2, y: (a.y+b.y)/2, distance: Math.hypot(a.x-b.x,a.y-b.y) }; };
  return {
    active: () => pointers.size > 0,
    reset() { pointers.clear();moved=pinched=true;camera.velocityYaw=camera.velocityPitch=0; },
    down(point: GestureInput, panOnly = false) {
      pointers.set(point.pointerId, point);
      camera.velocityYaw = 0; camera.velocityPitch = 0;
      if (pointers.size === 1) { start = last = point;lastTime=point.timeStamp??0;vx=vy=0; moved = false; pinched = false; pan = panOnly || !!point.shiftKey || point.button === 2; }
      else { pinched = moved = true; }
    },
    move(point: GestureInput) {
      if (!pointers.has(point.pointerId)) return false;
      const previous = pointers.size >= 2 ? midpoint() : null;
      pointers.set(point.pointerId, point);
      if (previous) {
        const current = midpoint();
        if (previous.distance > 0) zoomGraph(camera, current.distance / previous.distance, previous);
        camera.targetPanX += current.x - previous.x; camera.targetPanY += current.y - previous.y;
      } else if (!pinched) {
        const dx = point.x-last.x, dy = point.y-last.y, dt=Math.max(.008,((point.timeStamp??lastTime+16)-lastTime)/1000);lastTime=point.timeStamp??lastTime+16;
        moved ||= Math.hypot(point.x-start.x,point.y-start.y)>4;
        if (pan) { camera.targetPanX += dx; camera.targetPanY += dy; }
        else { vx=Math.max(-2,Math.min(2,dx*.005/dt));vy=Math.max(-2,Math.min(2,dy*.005/dt));camera.targetYaw += dx*.005; camera.targetPitch = Math.max(-1.2, Math.min(1.2,camera.targetPitch+dy*.005)); }
      }
      last = point; return true;
    },
    up(point: GestureInput,reduced=false) { const existed = pointers.delete(point.pointerId);if(existed&&!pointers.size&&moved&&!pinched&&!pan&&!reduced){camera.velocityYaw=vx*.32;camera.velocityPitch=vy*.32;} return existed && !moved && !pinched ? { x: point.x, y: point.y } : null; },
    cancel(id: number) { pointers.delete(id); moved = pinched = true; },
    wheel(delta: number, mode: number, anchor: GesturePoint) { zoomGraph(camera, Math.exp(-Math.max(-180,Math.min(180,delta*(mode===1?16:1)))*.0025),anchor); },
    doubleClick(anchor: GesturePoint) { zoomGraph(camera,1.8,anchor); },
  };
}

/** A repeated click preserves the selected view; a blank hit clears it. */
export function selectGraphHit(current:string,hit:string|undefined,onSelect:(id:string)=>void) {
  const next=hit??'';if(next!==current)onSelect(next);return next;
}
