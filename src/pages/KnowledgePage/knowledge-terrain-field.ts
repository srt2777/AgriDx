import type { RelationEdge } from '../../../shared/knowledge-relations';
import type { TerrainPoint } from './knowledge-terrain-layout';

export interface TerrainField { width: number; height: number; values: Float32Array }
const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** Splat truncated peaks and ridges into bounded grid regions, avoiding N × all pixels. */
export function terrainField(points: readonly TerrainPoint[], edges: readonly RelationEdge[], width: number, height: number): TerrainField {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 256 || height > 256) throw new Error('Invalid terrain grid');
  const values = new Float32Array(width * height), byId = new Map(points.map(point => [point.id, point]));
  const maxCount = Math.max(1, ...points.map(point => point.count));
  const splat = (minX:number, maxX:number, minY:number, maxY:number, sample:(x:number,y:number)=>number) => {
    const x0=Math.max(0,Math.floor(minX*(width-1))),x1=Math.min(width-1,Math.ceil(maxX*(width-1)));
    const y0=Math.max(0,Math.floor(minY*(height-1))),y1=Math.min(height-1,Math.ceil(maxY*(height-1)));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=y*width+x;values[i]=Math.max(values[i],clamp(sample(x/(width-1),y/(height-1))));}
  };
  for (const point of points) {
    if (point.count <= 0) continue;
    const peak=Math.log1p(point.count)/Math.log1p(maxCount), sigma=.012, reach=sigma*3;
    splat(point.x-reach,point.x+reach,point.y-reach,point.y+reach,(x,y)=>peak*Math.exp(-((x-point.x)**2+(y-point.y)**2)/(2*sigma*sigma)));
  }
  for (const edge of edges) {
    if (!(edge.strength > 0)) continue;
    const a=byId.get(edge.from),b=byId.get(edge.to); if(!a||!b||a.count<=0||b.count<=0)continue;
    const sigma=.018-.012*edge.strength, reach=sigma*3, reachSquared=reach*reach, dx=b.x-a.x,dy=b.y-a.y, length=dx*dx+dy*dy;
    splat(Math.min(a.x,b.x)-reach,Math.max(a.x,b.x)+reach,Math.min(a.y,b.y)-reach,Math.max(a.y,b.y)+reach,(x,y)=>{
      const t=length?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/length)):0;
      const d=(x-a.x-t*dx)**2+(y-a.y-t*dy)**2;
      return d<=reachSquared?edge.strength*Math.exp(-d/(2*sigma*sigma)):0;
    });
  }
  return { width,height,values };
}
