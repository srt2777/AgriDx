import type { TaxonomyNode } from './knowledge-taxonomy-data';

export const palette = ['#7398ff', '#8dd0ff', '#e578a8', '#e5c692', '#ef786f', '#c9a1dc', '#7bc6b4', '#efb28d', '#b8c56d', '#a8b7ea', '#69bbc2', '#d39772', '#b5a1f2', '#c1d8c4'];
export interface GraphPoint { x: number; y: number; z: number; color: string; phase: number }
function randomFor(id: string) {
  let seed = 2166136261;
  for (let index = 0; index < id.length; index++) seed = Math.imul(seed ^ id.charCodeAt(index), 16777619);
  return () => { seed += 0x6d2b79f5; let value = Math.imul(seed ^ seed >>> 15, seed | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}
/** Stable random volume, independent of array index. Knowledge identity and edges are untouched. */
export function graphPositions(nodes: TaxonomyNode[], colors: readonly string[] = palette) {
  const positions = new Map<string, GraphPoint>();
  const byId = new Map(nodes.map(node => [node.id, node]));
  const brands = nodes.filter(node => node.level === 'brand');
  const brandColors = new Map(brands.map((node, index) => [node.id, colors[index % colors.length] ?? palette[0]]));
  nodes.forEach(node => {
    let ancestor = node;
    while (ancestor.parent && byId.has(ancestor.parent)) ancestor = byId.get(ancestor.parent)!;
    const random = randomFor(node.id);
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = 2 * (.58 + .42 * Math.cbrt(random()));
    const radial = Math.sqrt(1 - y * y);
    positions.set(node.id, { x: radius * radial * Math.cos(angle), y: radius * y, z: radius * radial * Math.sin(angle), phase: random() * Math.PI * 2, color: brandColors.get(ancestor.id) ?? palette[0] });
  });
  return positions;
}

/** Coherent, bounded drift on all three axes plus radial breathing; no cumulative integration. */
export function fluidPosition(point: GraphPoint, time: number) {
  const phase = point.phase;
  const radial = 1 + .075 * Math.sin(time * .46 + phase);
  return {
    x: point.x * radial + .16 * Math.sin(time * .33 + phase) + .06 * Math.cos(time * .71 + phase * 2),
    y: point.y * radial + .15 * Math.cos(time * .39 + phase * 1.3),
    z: point.z * radial + .18 * Math.sin(time * .31 + phase * 1.7),
  };
}

/** Decorative diffusion particles carry no knowledge identity and never enter hit testing. */
export function diffusionParticle(index: number, time: number) {
  const random = randomFor(`diffusion:${index}`);
  const y = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const speed = .035 + random() * .035;
  const phase = (random() + time * speed) % 1;
  const radius = 1.75 + phase * 1.45;
  const theta = angle + .24 * Math.sin(time * .15 + index) + phase * .28;
  const radial = Math.sqrt(1 - y * y);
  return { x: radius * radial * Math.cos(theta), y: radius * y + .07 * Math.sin(time * .4 + index), z: radius * radial * Math.sin(theta), alpha: Math.sin(Math.PI * phase) ** 2 * .5, size: .5 + random() * 1.2 };
}
