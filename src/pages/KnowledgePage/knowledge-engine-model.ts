import type { TaxonomyNode } from './knowledge-taxonomy-data';

export interface EngineNode {
  id: string; label: string; x: number; y: number; z: number;
  level: TaxonomyNode['level'];
  radius: number; color: 'coral' | 'ivory' | 'gold'; cluster: number;
  born: number; hub: boolean; claim?: string; taxonomyId?: string;
}
export interface EngineEdge { from: number; to: number; born: number }
export interface EngineNetwork { nodes: EngineNode[]; edges: EngineEdge[]; hubs: number[] }
const CENTERS = [
  [-1.3, -1.05, .3], [-.7, -2.1, -.1], [-.1, -1.3, .4], [1.25, -.7, .25],
  [1.05, 1.0, .1], [.05, 2.05, -.1], [-.65, 1.4, .2], [-1.25, .25, .1],
  [.15, -.1, .7], [1.4, 1.65, -.2], [1.65, -1.4, -.05], [-.25, .65, -.2],
];
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
export function catalogNetwork(taxonomy: TaxonomyNode[]): EngineNetwork {
  const byId = new Map(taxonomy.map(node => [node.id, node]));
  const brands = taxonomy.filter(node => node.level === 'brand');
  const brandIndex = new Map(brands.map((node, i) => [node.id, i]));
  const points = new Map<string, EngineNode>();
  const place = (node: TaxonomyNode): EngineNode => {
    const existing = points.get(node.id); if (existing) return existing;
    const random = seededRandom(node.id);
    const parent = node.parent ? byId.get(node.parent) : undefined;
    const base = parent ? place(parent) : undefined;
    const cluster = base?.cluster ?? brandIndex.get(node.id) ?? 0;
    const center = CENTERS[cluster % CENTERS.length];
    const [dx, dy, dz] = offset(random, node.level === 'model' ? .65 : node.level === 'component' ? .27 : .13);
    const point: EngineNode = { id: node.id, taxonomyId: node.id, label: node.label, level: node.level, x: base ? base.x + dx : center[0], y: base ? base.y + dy : center[1], z: base ? base.z + dz : center[2] + (cluster >= 12 ? .9 : 0), radius: node.level === 'brand' ? .1 : node.level === 'model' ? .035 : node.level === 'component' ? .019 : .009, color: node.level === 'brand' || node.level === 'model' ? 'ivory' : 'coral', cluster, born: 0, hub: node.level === 'brand', claim: `${node.count} 条关联资料 · ${node.count ? '目录归属' : '待补资料'}` };
    points.set(node.id, point); return point;
  };
  const nodes = taxonomy.map(place), index = new Map(nodes.map((node, i) => [node.id, i]));
  const edges = taxonomy.flatMap((node, to) => node.parent && index.has(node.parent) ? [{ from: index.get(node.parent)!, to, born: 0 }] : []);
  return { nodes, edges, hubs: nodes.map((node, i) => node.hub ? i : -1).filter(i => i >= 0) };
}
