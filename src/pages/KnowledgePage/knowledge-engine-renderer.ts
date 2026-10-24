import type { EngineNetwork, EngineNode } from './knowledge-engine-model';
import type { GraphCamera } from './graph-interaction';
import { placeGraphLabels, projectEnginePoint, type LabelBox } from './graph-visuals';
import { modelOffsets } from './knowledge-engine-model';
import { graphNodeScale } from './graph-interaction';

export interface EngineHit { index: number; x: number; y: number; radius: number; width?: number }
interface Projected { x: number; y: number; z: number; radius: number; visible: boolean }
export interface EngineScene {
  time: number; active: number; hover: number; related: Set<string>; focusMode: boolean; animate: boolean; camera: GraphCamera; tooltip: HTMLElement | null; highContrast?: boolean;
}
function sprite(node: EngineNode) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const c=canvas.getContext('2d')!;
  const channels=node.color.replace('#','').match(/../g)?.map(c=>parseInt(c,16))??[120,180,220];
  const mix={brand:0,model:.32,component:.12,part:.22}[node.level],target=node.level==='part'?[140,100,240]:[220,255,255];
  const tone='#'+channels.map((v,i)=>Math.round(v+(target[i]-v)*mix).toString(16).padStart(2,'0')).join('');
  c.beginPath();
  if(node.level==='model') {c.moveTo(32,3);c.lineTo(61,32);c.lineTo(32,61);c.lineTo(3,32);c.closePath();}
  else if(node.level==='component') c.roundRect(5,5,54,54,10);
  else if(node.level==='part') {c.moveTo(32,4);c.lineTo(60,58);c.lineTo(4,58);c.closePath();}
  else c.arc(32,32,29,0,Math.PI*2);
  if(node.count) {const gradient=c.createRadialGradient(23,18,1,32,32,38);gradient.addColorStop(0,node.level==='model'?'#ffffff':node.color);gradient.addColorStop(.45,tone);gradient.addColorStop(1,'#14202a');c.fillStyle=gradient;c.fill();}
  c.strokeStyle=node.color;c.lineWidth=node.count?2:5;if(!node.count)c.setLineDash([7,4]);c.stroke();return canvas;
}
/** Perspective canvas renderer; cached shaded sprites keep 3k+ nodes usable without WebGL. */
export class KnowledgeEngineRenderer {
  private context: CanvasRenderingContext2D;
  private sprites = new Map<string,HTMLCanvasElement>();
  readonly extent: number;
  private expandedKey='';
  private expanded=new Map<number,{x:number;y:number;z:number}>();
  private labelKey='';
  private labelBoxes:LabelBox[]=[];
  private labelWidths=new Map<string,number>();
  private points: Projected[];
  private order: number[];
  private width = 0;
  private height = 0;
  hits: EngineHit[] = [];
  constructor(private canvas: HTMLCanvasElement, private network: EngineNetwork) {
    this.context = canvas.getContext('2d')!;
    this.extent=Math.max(2,...network.nodes.map(n=>Math.hypot(n.x,n.y,n.z)+.5));
    network.nodes.forEach(n=>{const key=`${n.color}:${n.level}:${!!n.count}`;if(!this.sprites.has(key))this.sprites.set(key,sprite(n));});
    this.points = network.nodes.map(() => ({ x: 0, y: 0, z: 0, radius: 0, visible: false }));
    this.order = network.nodes.map((_, i) => i);
  }
  pick(x: number, y: number) {
    return [...this.hits].reverse().filter(hit => hit.width ? Math.abs(x-hit.x-hit.width/2)<=Math.max(22,hit.width/2)&&Math.abs(y-hit.y)<=22 : Math.hypot(hit.x-x,hit.y-y)<=Math.max(22,hit.radius+3)).sort((a,b)=>Number(!!b.width)-Number(!!a.width)||Math.hypot(a.x-x,a.y-y)-Math.hypot(b.x-x,b.y-y))[0];
  }
  draw(scene: EngineScene) {
    const { canvas, context: c, network, points } = this;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width; this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#0e1211'; c.fillRect(0, 0, width, height);
    const unit = width / 1080, { camera: view, time } = scene;
    const selected=network.nodes[scene.active];
    const children=scene.focusMode&&selected?network.edges.filter(e=>e.from===scene.active).map(e=>e.to):[];
    const expandedKey=`${scene.focusMode}:${scene.active}`;
    if(expandedKey!==this.expandedKey){const offsets=modelOffsets(children.length);this.expanded=new Map(children.map((id,i)=>{const p=offsets[i],factor=this.extent/Math.max(3,Math.cbrt(children.length)*2);return [id,{x:p.x*factor,y:p.y*factor,z:p.z*factor}];}));this.expandedKey=expandedKey;}
    const expanded=this.expanded;
    network.nodes.forEach((node, i) => {
      const offset=expanded.get(i);
      const position=offset&&selected?{x:selected.x+offset.x,y:selected.y+offset.y,z:selected.z+offset.z}:node;
      const projected=projectEnginePoint(position,view,width,height,this.extent);
      const point=points[i];point.x=projected.x;point.y=projected.y;point.z=projected.depth;point.visible=true;
      const minimum={brand:7,model:4.5,component:2.5,part:1.5}[node.level];
      point.radius=Math.max(minimum,node.radius*projected.scale*graphNodeScale(view.zoom))*(scene.hover===i?1.2:1);
    });
    c.lineWidth = Math.max(.35, .55 * unit);
    for (let group = 0; group < 2; group++) {
      c.beginPath(); c.strokeStyle = (scene.highContrast??matchMedia('(forced-colors: active)').matches)?'#dceeff':group ? '#b8beb36e' : '#93bbce66';
      for (const edge of network.edges) {
        if ((scene.related.has(network.nodes[edge.from].id)&&scene.related.has(network.nodes[edge.to].id)?1:0) !== group) continue;
        const a = points[edge.from], b = points[edge.to];
        c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      }
      c.globalAlpha=selected && !group ? .08 : .45;c.stroke();c.globalAlpha=1;
    }
    if(scene.animate) {
      for(const edge of network.edges) {
        if(selected&&(!scene.related.has(network.nodes[edge.from].id)||!scene.related.has(network.nodes[edge.to].id)))continue;
        const a=points[edge.from],b=points[edge.to],t=(time*.16+edge.to*.037)%1;
        c.fillStyle=network.nodes[edge.to].color;c.globalAlpha=.65;c.beginPath();c.arc(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,1.3,0,Math.PI*2);c.fill();
      }c.globalAlpha=1;
    }
    const activeNode = network.nodes[scene.active];
    if (activeNode && points[scene.active].visible) {
      c.beginPath(); c.strokeStyle = '#f5b09365'; c.lineWidth = .9 * unit;
      for (const edge of network.edges) {
        if(!scene.related.has(network.nodes[edge.from].id)||!scene.related.has(network.nodes[edge.to].id))continue;
        const a = points[edge.from], b = points[edge.to]; c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      }
      c.stroke();
    }
    this.order.sort((a, b) => points[b].z - points[a].z);
    this.hits = [];
    for (const i of this.order) {
      const node = network.nodes[i], p = points[i];
      if (!p.visible || p.x < -60 || p.y < -60 || p.x > width + 60 || p.y > height + 60) continue;
      c.globalAlpha = selected&&!scene.related.has(node.id) ? .1 : Math.max(.45,Math.min(1,.85-p.z/this.extent*.18));
      c.drawImage(this.sprites.get(`${node.color}:${node.level}:${!!node.count}`)!, p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      this.hits.push({ index: i, x: p.x, y: p.y, radius: p.radius });
    }
    c.globalAlpha = 1;
    const labelKey=[width,height,view.yaw,view.pitch,view.zoom,view.panX,view.panY,scene.active,scene.hover,scene.focusMode].join(':');
    if(labelKey!==this.labelKey) {
    const requests=network.nodes.flatMap((node,i)=>{
      const p=points[i],mandatory=scene.related.has(node.id)||scene.hover===i;
      const level={brand:0,model:1,component:2,part:3}[node.level];
      if(!mandatory&&(view.zoom<[.4,1.8,3.5,6][level]||p.x<0||p.y<0||p.x>width||p.y>height))return [];
      c.font=`${mandatory?600:400} 12px system-ui`;
      return [{id:String(i),x:p.x,y:p.y,width:Math.max(44,Math.min(width-16,this.labelWidths.get(node.id) ?? (()=>{const w=c.measureText(node.label).width+12;this.labelWidths.set(node.id,w);return w;})())),height:44,priority:i===scene.active?-2:scene.hover===i?-1:level,mandatory}];
    });
    this.labelBoxes=placeGraphLabels(requests,width,height);this.labelKey=labelKey;
    }
    for(const box of this.labelBoxes) {
      const i=Number(box.id),p=points[i],node=network.nodes[i];
      c.globalAlpha=selected && !box.mandatory ? .25 : 1;
      c.strokeStyle=node.color;c.lineWidth=.6;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(box.left+box.width/2,box.top+box.height/2);c.stroke();
    }
    for(const box of this.labelBoxes){const i=Number(box.id);c.globalAlpha=selected && !box.mandatory ? .25 : 1;this.label(network.nodes[i].label,box.left+3,box.top+box.height/2,12,i===scene.active?'#ffe29a':'#f5f8ff',i,box.width);}
    c.globalAlpha=1;
    if (activeNode && points[scene.active].visible) {
      const p = points[scene.active];
      c.beginPath(); c.strokeStyle = '#e9c777'; c.lineWidth = 1.5;
      c.arc(p.x, p.y, p.radius + 3 + (scene.animate?Math.sin(time*2)*1.5:0), 0, Math.PI * 2); c.stroke();
    }
    const tipIndex=scene.hover;
    if(scene.tooltip&&points[tipIndex]) {
      const p=points[tipIndex],cardWidth=Math.min(width-24,240);
      scene.tooltip.style.display='';scene.tooltip.style.width=`${cardWidth}px`;
      const h=scene.tooltip.offsetHeight;
      scene.tooltip.style.transform=`translate(${Math.max(12,Math.min(width-cardWidth-12,p.x+16))}px,${Math.max(12,Math.min(height-h-12,p.y-h-12))}px)`;
    } else if(scene.tooltip)scene.tooltip.style.display='none';
    c.globalAlpha = 1;
  }

  private label(text: string, x: number, y: number, size: number, color: string, index: number, maxWidth=Infinity) {
    const c = this.context; c.font = `600 ${Math.max(7, size)}px ui-monospace, 'SFMono-Regular', Consolas, monospace`;
    const width = Math.min(maxWidth,c.measureText(text).width + 12), height = Math.max(44, size * 1.65);
    if (x < 0 || y < 0 || x > this.width || y > this.height) return;
    c.fillStyle = '#050908ed'; c.fillRect(x - 3, y - height / 2, width, height);
    c.fillStyle = color; c.fillText(text, x + 2, y + size * .32, Math.max(1,width-8));
    this.hits.push({ index, x: x - 3, y, radius: 0, width });
  }
}
