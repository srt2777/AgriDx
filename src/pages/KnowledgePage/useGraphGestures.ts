import { useEffect, useLayoutEffect, useState, useRef, type RefObject, type PointerEvent, type MouseEvent } from 'react';
import type { GraphCamera } from './graph-interaction';
import { createGraphGestures, type GesturePoint } from './graph-gestures';
export function useGraphGestures(canvas: RefObject<HTMLCanvasElement | null>, camera: RefObject<GraphCamera>, options: {
  wake: () => void; pick: (point: GesturePoint) => void; hover?: (point: GesturePoint | null) => void; panOnly?: boolean; reduced?:boolean; revision?: unknown;
}) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; });
  const [controller] = useState(() => createGraphGestures(camera.current!));
  const point = (event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX-rect.left-rect.width/2, y: event.clientY-rect.top-rect.height/2 };
  };
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); const box=element.getBoundingClientRect(); controller.wheel(event.deltaY,event.deltaMode,{x:event.clientX-box.left-box.width/2,y:event.clientY-box.top-box.height/2}); latest.current.wake(); };
    element.addEventListener('wheel',wheel,{passive:false}); return () => { element.removeEventListener('wheel',wheel);controller.reset(); };
  },[canvas,controller,options.revision]);
  return { controller, bindings: {
    onPointerDown(event: PointerEvent<HTMLCanvasElement>) { event.currentTarget.setPointerCapture(event.pointerId); controller.down({...point(event),pointerId:event.pointerId,timeStamp:event.timeStamp,shiftKey:event.shiftKey,button:event.button},latest.current.panOnly); latest.current.hover?.(null); },
    onPointerMove(event: PointerEvent<HTMLCanvasElement>) { if (controller.move({...point(event),pointerId:event.pointerId,timeStamp:event.timeStamp})) latest.current.wake(); else latest.current.hover?.(point(event)); },
    onPointerUp(event: PointerEvent<HTMLCanvasElement>) { const hit=controller.up({...point(event),pointerId:event.pointerId},latest.current.reduced); if(hit) latest.current.pick(hit);latest.current.wake(); },
    onPointerCancel(event: PointerEvent<HTMLCanvasElement>) { controller.cancel(event.pointerId); },
    onLostPointerCapture(event: PointerEvent<HTMLCanvasElement>) { controller.cancel(event.pointerId); },
    onPointerLeave() { if (!controller.active()) latest.current.hover?.(null); },
    onContextMenu(event: MouseEvent<HTMLCanvasElement>) { event.preventDefault(); },
    onDoubleClick(event: MouseEvent<HTMLCanvasElement>) { controller.doubleClick(point(event)); latest.current.wake(); },
  }};
}
