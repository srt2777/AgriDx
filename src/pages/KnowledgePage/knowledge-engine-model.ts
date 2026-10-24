import type { TaxonomyNode } from './knowledge-taxonomy-data';

export type EngineMode = 'reference' | 'catalog';
export interface EngineNode {
  id: string; label: string; x: number; y: number; z: number;
  radius: number; color: 'coral' | 'ivory' | 'gold'; cluster: number;
  born: number; hub: boolean; claim?: string; taxonomyId?: string;
}
export interface EngineEdge { from: number; to: number; born: number }
export interface EngineNetwork { nodes: EngineNode[]; edges: EngineEdge[]; hubs: number[] }
export const REFERENCE_DURATION = 24;
export const REFERENCE_URL = 'https://x.com/Argona0x/status/2113709216888222007';
export const PAGE_NAMES = ['capture', 'sources', 'memory', 'projects', 'routines', 'decisions', 'people', 'writing', 'research', 'context', 'inbox', 'index'];
export const CLAIMS = ['Keep every original untouched', 'Cite original source evidence', 'Reuse persistent wiki memory', 'Start work on an active project', 'Review runs daily at 02:00', 'Link decisions to evidence', 'Link people to their projects', 'File useful answers as pages', 'Trace each claim to its source', 'Reuse context across sessions', 'Route input through the reader', 'Rebuild links after every write'];
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
/** A deterministic, explicitly labelled visual simulation. It never enters the knowledge API. */
export function referenceNetwork(): EngineNetwork {
  const random = seededRandom('argona-knowledge-engine-reference');
  const nodes: EngineNode[] = PAGE_NAMES.map((name, i) => ({ id: `wiki/${name}.md`, label: `${name}.md`, x: CENTERS[i][0], y: CENTERS[i][1], z: CENTERS[i][2], radius: i === 8 ? .15 : .08 + random() * .04, color: 'ivory', cluster: i, born: 0, hub: true, claim: CLAIMS[i] }));
  nodes.push({ id: 'raw/source-042.pdf', label: 'raw/source-042.pdf', x: -2.18, y: .85, z: .35, radius: .105, color: 'gold', cluster: 12, born: 0, hub: true, claim: 'READ ONLY · NO MUTATIONS' });
  nodes.push({ id: 'wiki/answer-013.md', label: 'answer-013.md', x: 1.55, y: -2.05, z: .1, radius: .07, color: 'ivory', cluster: 10, born: 10.1, hub: true, claim: 'Review runs daily at 02:00' });
  for (let i = nodes.length; i < 3287; i++) {
    const cluster = i % 59 === 0 ? 12 : i % 12;
    const center = cluster === 12 ? [-2.18, .85, .35] : CENTERS[cluster];
    const [x, y, z] = offset(random, cluster === 12 ? .45 : cluster === 8 ? .9 : .6 + random() * .22);
    const born = i < 2737 ? 0 : 3 + (i - 2737) / 550 * 6.2;
    nodes.push({ id: `ref:${i}`, label: `${(PAGE_NAMES[cluster] ?? 'src').slice(0, 3)}:${String(i).padStart(4, '0')}`, x: center[0] + x, y: center[1] + y, z: center[2] + z, radius: .006 + random() ** 4 * .032, color: random() < .26 ? 'ivory' : 'coral', cluster, born, hub: false });
  }
  const groups = Array.from({ length: 13 }, (_, cluster) => nodes.map((node, index) => ({ node, index })).filter(item => item.node.cluster === cluster).map(item => item.index));
  const edges: EngineEdge[] = [], keys = new Set<string>();
  const add = (from: number, to: number) => {
    if (from === to) return;
    const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
    if (keys.has(key)) return;
    keys.add(key); edges.push({ from, to, born: Math.max(nodes[from].born, nodes[to].born) });
  };
  for (let i = 14; i < nodes.length; i++) {
    add(i, nodes[i].cluster);
    const group = groups[nodes[i].cluster];
    // Local links create the fine mesh visible in the reference, without long random chords.
    const candidates = Array.from({ length: 18 }, () => group[Math.floor(random() * group.length)]);
    candidates.sort((a, b) => Math.hypot(nodes[a].x - nodes[i].x, nodes[a].y - nodes[i].y, nodes[a].z - nodes[i].z) - Math.hypot(nodes[b].x - nodes[i].x, nodes[b].y - nodes[i].y, nodes[b].z - nodes[i].z));
    for (const target of candidates.slice(0, 2)) add(i, target);
  }
  for (let i = 0; i < 12; i++) { add(i, (i + 1) % 12); add(i, 12); add(i, (i + 4) % 12); }
  add(13, 4); add(13, 11);
  while (edges.length < 11663) {
    const from = 14 + Math.floor(random() * (nodes.length - 14));
    const group = groups[nodes[from].cluster];
    add(from, group[Math.floor(random() * group.length)]);
  }
  return { nodes, edges, hubs: nodes.map((node, i) => node.hub ? i : -1).filter(i => i >= 0) };
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
    // Fibonacci sphere spreads all brands through depth instead of stacking clusters.
    const sphereY = 1 - 2 * (cluster + .5) / Math.max(1, brands.length);
    const sphereR = Math.sqrt(1 - sphereY * sphereY);
    const angle = cluster * Math.PI * (3 - Math.sqrt(5));
    const center = [2 * sphereR * Math.cos(angle), 2 * sphereY, 2 * sphereR * Math.sin(angle)];
    const [dx, dy, dz] = offset(random, node.level === 'model' ? .65 : node.level === 'component' ? .27 : .13);
    const point: EngineNode = { id: node.id, taxonomyId: node.id, label: node.label, x: base ? base.x + dx : center[0], y: base ? base.y + dy : center[1], z: base ? base.z + dz : center[2], radius: node.level === 'brand' ? .1 : node.level === 'model' ? .035 : node.level === 'component' ? .019 : .009, color: node.level === 'brand' || node.level === 'model' ? 'ivory' : 'coral', cluster, born: 0, hub: node.level === 'brand', claim: `${node.count} 条关联资料 · ${node.count ? '目录归属' : '待补资料'}` };
    points.set(node.id, point); return point;
  };
  const nodes = taxonomy.map(place), index = new Map(nodes.map((node, i) => [node.id, i]));
  const edges = taxonomy.flatMap((node, to) => node.parent && index.has(node.parent) ? [{ from: index.get(node.parent)!, to, born: 0 }] : []);
  return { nodes, edges, hubs: nodes.map((node, i) => node.hub ? i : -1).filter(i => i >= 0) };
}
export function referenceFrame(seconds: number) {
  const time = Math.max(0, Math.min(REFERENCE_DURATION, seconds));
  const writes = Math.min(12, Math.max(0, Math.floor((time - 3) / .54) + 1));
  const phase = time < 3 ? 'READER' : time < 9.5 ? 'LIBRARIAN' : time < 14 ? 'ANSWER' : time < 21 ? 'CHECKER' : 'REVIEW';
  const active = phase === 'READER' ? 12 : phase === 'LIBRARIAN' ? Math.min(writes - 1, 11) : phase === 'ANSWER' ? 13 : 4;
  const conflict = time >= 17;
  const command = phase === 'READER' ? '> reader ingest raw/source-042.pdf --read-only' : phase === 'LIBRARIAN' ? '> librarian patch wiki/ --source 042' : phase === 'ANSWER' ? '> librarian answer --save wiki/answer-013.md' : phase === 'CHECKER' ? '> checker audit --nightly --source-links' : '> checker flag routines.md --notify @you';
  return { time, phase, active, writes, conflict, command, scan: time < 14 ? 0 : Math.min(129, Math.floor((time - 14) * 29)), documents: time < 10.1 ? 128 : 129 };
}
