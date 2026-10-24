import { useEffect, type RefObject } from 'react';
/** Shared focus trap; Escape closes only the overlay and restores the originating control. */
export function useGraphOverlay(expanded:boolean,container:RefObject<HTMLElement|null>,canvas:RefObject<HTMLCanvasElement|null>,close:()=>void) {
  useEffect(()=>{
    if(!expanded)return;
    // Portals replace the DOM root without replacing the component or camera.
    const getCurrentContainer=()=>container.current;
    const previous=document.body.style.overflow, previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow='hidden';canvas.current?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
      if(event.key!=='Tab')return;
      const controls=[...(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),canvas[tabindex],a[href],summary')??[])].filter(n=>!n.closest('[hidden]')&&n.getClientRects().length>0);
      const first=controls[0],last=controls.at(-1);if(!first||!last)return;
      if(event.shiftKey&&(document.activeElement===first||!container.current?.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!container.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',key,true);if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});else getCurrentContainer()?.querySelector<HTMLElement>('[data-overlay-toggle],button')?.focus({preventScroll:true});};
  },[expanded,container,canvas,close]);
}
