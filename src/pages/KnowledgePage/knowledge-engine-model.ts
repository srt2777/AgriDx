import { palette } from './taxonomy-graph-layout';
import type { TaxonomyNode } from './knowledge-taxonomy-data';

export interface EngineNode {
  id: string; label: string; x: number; y: number; z: number;
  radius: number; color: string; cluster: number; level: TaxonomyNode['level']; count: number;
  born: number; hub: boolean; claim?: string; taxonomyId?: string;
}
export interface EngineEdge { from: number; to: number; born: number }
export interface EngineNetwork { nodes: EngineNode[]; edges: EngineEdge[]; hubs: number[] }
export function brandCenters(count:number, bound=1) {
  const radius=Math.max(2,Math.sqrt(count)*1.4)*bound;
  return Array.from({length:count},(_,i)=>{ const y=1-2*(i+.5)/count, angle=i*Math.PI*(3-Math.sqrt(5)), r=Math.sqrt(1-y*y); return {x:radius*r*Math.cos(angle),y:radius*y,z:radius*r*Math.sin(angle)}; });
}
export function modelOffsets(count:number) {
  const n=Math.ceil(Math.cbrt(count+1)); const points:{x:number;y:number;z:number}[]=[];
  for(let x=0;x<n;x++)for(let y=0;y<n;y++)for(let z=0;z<n;z++) {const p={x:(x-(n-1)/2)*1.2,y:(y-(n-1)/2)*1.2,z:(z-(n-1)/2)*1.2};if(Math.hypot(p.x,p.y,p.z)>.1)points.push(p);}
  return points.slice(0,count);
}
export function seededRandom(id: string) {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return () => { seed += 0x6d2b79f5; let n = Math.imul(seed ^ seed >>> 15, seed | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
function offset(random: () => number, size: number) {
  const y = random() * 2 - 1, angle = random() * Math.PI * 2;
  const radius = size * Math.cbrt(random()), r = Math.sqrt(1 - y * y);
  return [radius * r * Math.cos(angle), radius * y, radius * r * Math.sin(angle)];
}
/** Real catalog mode contains exactly the original identities and parent edges, including gaps. */
export function catalogNetwork(taxonomy: TaxonomyNode[], colors: readonly string[] = palette): EngineNetwork {
  const byId = new Map(taxonomy.map(node => [node.id, node]));
  const brands = taxonomy.filter(node => node.level === 'brand');
  const brandIndex = new Map(brands.map((node, i) => [node.id, i]));
  const modelPositions=new Map<string,{x:number;y:number;z:number}>();
  let bound=1;
  for(const brand of brands) {const children=taxonomy.filter(n=>n.parent===brand.id);const offsets=modelOffsets(children.length);children.forEach((n,i)=>modelPositions.set(n.id,offsets[i]));bound=Math.max(bound,...offsets.map(p=>Math.hypot(p.x,p.y,p.z)+.5));}
  const centers=brandCenters(brands.length,bound);
  const points = new Map<string, EngineNode>();
  const place = (node: TaxonomyNode): EngineNode => {
    const existing = points.get(node.id); if (existing) return existing;
    const random = seededRandom(node.id);
    const parent = node.parent ? byId.get(node.parent) : undefined;
    const base = parent ? place(parent) : undefined;
    const cluster = base?.cluster ?? brandIndex.get(node.id) ?? 0;
    const center = centers[cluster] ?? {x:0,y:0,z:0};
    const local=modelPositions.get(node.id);
    const [dx, dy, dz] = local ? [local.x,local.y,local.z] : offset(random, node.level === 'component' ? .18 : .06);
    const point: EngineNode = { id: node.id, taxonomyId: node.id, label: node.label, x: base ? base.x + dx : center.x, y: base ? base.y + dy : center.y, z: base ? base.z + dz : center.z, radius: node.level === 'brand' ? .1 : node.level === 'model' ? .035 : node.level === 'component' ? .019 : .009, color: colors[cluster % Math.max(1,colors.length)] ?? palette[0], cluster, level:node.level, count:node.count, born: 0, hub: node.level === 'brand', claim: `${node.count} 条关联资料 · ${node.count ? '目录归属' : '待补资料'}` };
    points.set(node.id, point); return point;
  };
  const nodes = taxonomy.map(place), index = new Map(nodes.map((node, i) => [node.id, i]));
  const edges = taxonomy.flatMap((node, to) => node.parent && index.has(node.parent) ? [{ from: index.get(node.parent)!, to, born: 0 }] : []);
  return { nodes, edges, hubs: nodes.map((node, i) => node.hub ? i : -1).filter(i => i >= 0) };
}
