import type { RelationEdge } from '../../../shared/knowledge-relations';
import type { GraphCamera } from './graph-interaction';
import type { TerrainField } from './knowledge-terrain-field';
import type { ContourSegment } from './knowledge-terrain-contours';
import type { TerrainPoint } from './knowledge-terrain-layout';

interface Frame { field: TerrainField; contours: ContourSegment[]; points: TerrainPoint[]; edges: RelationEdge[]; selectedId: string; mapT: number; camera: GraphCamera; palette: readonly string[]; light: boolean }
/** Canvas-only shared height-field projection; no WebGL state or GPU API. */
export class TerrainRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private hits: { id:string; x:number; y:number }[]=[];
  constructor(private readonly canvas: HTMLCanvasElement) { const ctx=canvas.getContext('2d'); if(!ctx)throw Error('Canvas 2D unavailable');this.ctx=ctx; }
  pick(x:number,y:number) { let best:{id:string;distance:number}|undefined;for(const p of this.hits){const distance=Math.hypot(p.x-x,p.y-y);if(distance<12&&(!best||distance<best.distance))best={id:p.id,distance};}return best?.id; }
  draw(frame: Frame) {
    const started=performance.now(), {field,contours,points,edges,selectedId,mapT,camera,palette,light}=frame, c=this.ctx;
    const rect=this.canvas.getBoundingClientRect(), width=rect.width,height=rect.height;if(!width||!height)return 0;
    const dpr=Math.min(devicePixelRatio||1,2), pixelWidth=Math.round(width*dpr),pixelHeight=Math.round(height*dpr);
    if(this.canvas.width!==pixelWidth||this.canvas.height!==pixelHeight){this.canvas.width=pixelWidth;this.canvas.height=pixelHeight;}
    c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle=light?'#f4f6f3':'#101916';c.fillRect(0,0,width,height);
    const size=Math.min(width*.82,height*.9)*camera.zoom, yaw=camera.yaw, cy=Math.cos(yaw),sy=Math.sin(yaw);
    const project=(x:number,y:number,z:number):[number,number]=>{
      const xx=(x-.5)*cy-(y-.5)*sy, yy=(x-.5)*sy+(y-.5)*cy;
      const perspective = Math.max(.3, Math.min(.8, .54 + camera.pitch * .2));
      return [width/2+xx*size+camera.panX,height/2+yy*size*(1-(1-perspective)*mapT)-z*size*.22*mapT+camera.panY];
    };
    const brands=points.filter(p=>p.level==='brand'), byId=new Map(points.map(p=>[p.id,p]));
    const color=(x:number,y:number)=>{let best=0,d=Infinity;brands.forEach((brand,i)=>{const n=(brand.x-x)**2+(brand.y-y)**2;if(n<d){best=i;d=n;}});return palette[best%palette.length]||'#729b80';};
    const cells:{ x:number;y:number;depth:number }[]=[];
    for(let y=0;y<field.height-1;y++)for(let x=0;x<field.width-1;x++)cells.push({x,y,depth:(x/(field.width-1)-.5)*sy+(y/(field.height-1)-.5)*cy});
    if(mapT>.01)cells.sort((a,b)=>a.depth-b.depth);
    const point=(x:number,y:number)=>{const z=field.values[y*field.width+x];return project(x/(field.width-1),y/(field.height-1),z);};
    for(const {x,y} of cells){const p=[point(x,y),point(x+1,y),point(x+1,y+1),point(x,y+1)],h=field.values[y*field.width+x];c.beginPath();c.moveTo(...p[0]);for(let i=1;i<4;i++)c.lineTo(...p[i]);c.closePath();c.globalAlpha=light ? .12+h*.34 : .10+h*.45;c.fillStyle=color(x/(field.width-1),y/(field.height-1));c.fill();}
    c.globalAlpha=1;
    c.strokeStyle=light?'#385848aa':'#b9d8c8aa';
    for(const major of [false,true]){c.lineWidth=major?1.25:.55;c.beginPath();for(const line of contours){if((Math.round(line.level*13)%4===0)!==major)continue;const a=project(line.a[0],line.a[1],line.level),b=project(line.b[0],line.b[1],line.level);c.moveTo(...a);c.lineTo(...b);}c.stroke();}
    // When selected, show all of its relation types; the field itself uses every provided edge.
    if(selectedId){for(const edge of edges){if(edge.from!==selectedId&&edge.to!==selectedId)continue;const a=byId.get(edge.from),b=byId.get(edge.to);if(!a||!b)continue;c.setLineDash(edge.type==='semantic'?[7,5]:edge.type==='shared-component'?[2,4]:[]);c.strokeStyle=edge.type==='semantic'?'#d4a357':edge.type==='shared-component'?'#63b5c0':'#a9c4a6';c.lineWidth=1.5;const p=project(a.x,a.y,edge.strength),q=project(b.x,b.y,edge.strength);c.beginPath();c.moveTo(...p);c.lineTo(...q);c.stroke();}c.setLineDash([]);}
    this.hits=[];for(const p of points){const x=Math.round(p.x*(field.width-1)),y=Math.round(p.y*(field.height-1)),heightValue=field.values[y*field.width+x]||0;const pos=project(p.x,p.y,heightValue);this.hits.push({id:p.id,x:pos[0],y:pos[1]});if(p.level==='brand'||p.id===selectedId){c.fillStyle=p.id===selectedId?'#efb65c':color(p.x,p.y);c.beginPath();c.arc(pos[0],pos[1],p.id===selectedId?5:3,0,Math.PI*2);c.fill();c.fillStyle=light?'#182821':'#e5f0e9';c.font='12px system-ui';c.fillText(p.label,pos[0]+7,pos[1]-5);}}
    return performance.now()-started;
  }
}
