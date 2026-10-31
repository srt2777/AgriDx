import type { EngineNetwork, EngineNode } from './knowledge-engine-model';
import type { GraphCamera } from './graph-interaction';
import { graphNodeScale } from './graph-interaction';

export interface EngineHit { index: number; x: number; y: number; radius: number; width?: number }
interface Projected { x: number; y: number; z: number; radius: number; visible: boolean }
export interface EngineScene {
  time: number; active: number; animate: boolean; camera: GraphCamera; tooltip: HTMLElement | null;
}
function sphere(color: EngineNode['color']) {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
  const c = canvas.getContext('2d')!;
  const gradient = c.createRadialGradient(32, 26, 1, 49, 49, 46);
  const stops = color === 'gold' ? ['#fff1a8', '#efc544', '#bc8c1d', '#40391e'] : color === 'ivory' ? ['#fff9eb', '#d7d4c7', '#9a9c93', '#343b36'] : ['#ffd0bc', '#fb9682', '#c85c53', '#452b28'];
  [0, .32, .7, 1].forEach((stop, i) => gradient.addColorStop(stop, stops[i]));
  c.fillStyle = gradient; c.beginPath(); c.arc(48, 48, 46, 0, Math.PI * 2); c.fill();
  return canvas;
}
/** Perspective canvas renderer; cached shaded sprites keep 3k+ nodes usable without WebGL. */
export class KnowledgeEngineRenderer {
  private context: CanvasRenderingContext2D;
  private sprites = { coral: sphere('coral'), ivory: sphere('ivory'), gold: sphere('gold') };

  private points: Projected[];
  private order: number[];
  private width = 0;
  private height = 0;
  hits: EngineHit[] = [];
  constructor(private canvas: HTMLCanvasElement, private network: EngineNetwork) {
    this.context = canvas.getContext('2d')!;
    this.points = network.nodes.map(() => ({ x: 0, y: 0, z: 0, radius: 0, visible: false }));
    this.order = network.nodes.map((_, i) => i);
  }
  pick(x: number, y: number) {
    return [...this.hits].reverse().find(hit => hit.width ? x >= hit.x && x <= hit.x + hit.width && Math.abs(y - hit.y) <= 12 : Math.hypot(hit.x - x, hit.y - y) <= Math.max(5, hit.radius + 3));
  }
  /** Includes off-canvas points so a directory or search selection can be centered. */
  point(index: number) {
    const point = this.points[index];
    return point?.visible ? { x: point.x, y: point.y } : undefined;
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
    const lodParts = view.zoom < .72;
    const scale = Math.min(width / 5.85, height / 5.65) * view.zoom;
    const yaw = view.yaw + (scene.animate ? time * .017 : 0);
    const pitch = view.pitch + (scene.animate ? Math.sin(time * .18) * .025 : 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    network.nodes.forEach((node, i) => {
      const point = points[i]; point.visible = true;
      if (lodParts && node.level === 'part' && scene.active !== i) point.visible = false;
      if (!point.visible) return;
      const drift = scene.animate ? Math.sin(time * .35 + node.cluster) * .018 : 0;
      const x = node.x + drift, y = node.y + drift * .5, z = node.z;
      const rx = x * cy + z * sy, rz = -x * sy + z * cy;
      const ry = y * cp - rz * sp, depth = rz * cp + y * sp, perspective = 7 / (7 + depth);
      point.x = width / 2 + rx * scale * perspective + view.panX;
      point.y = height * .49 - ry * scale * perspective + view.panY;
      point.z = depth;
      point.radius = Math.max(.48 * unit, node.radius * scale * perspective * graphNodeScale(view.zoom));
    });
    c.lineWidth = Math.max(.35, .55 * unit);
    for (let group = 0; group < 2; group++) {
      c.beginPath(); c.strokeStyle = group ? '#b8beb32e' : '#e0837036';
      for (const edge of network.edges) {
        if (!points[edge.from].visible || !points[edge.to].visible) continue;
        if ((network.nodes[edge.from].color === 'ivory' ? 1 : 0) !== group) continue;
        const a = points[edge.from], b = points[edge.to];
        c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      }
      c.stroke();
    }
    const activeNode = network.nodes[scene.active];
    if (activeNode && points[scene.active].visible) {
      c.beginPath(); c.strokeStyle = '#f5b09365'; c.lineWidth = .9 * unit;
      for (const edge of network.edges) {
        if (edge.from !== scene.active && edge.to !== scene.active) continue;
        const a = points[edge.from], b = points[edge.to]; c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      }
      c.stroke();
    }
    this.order.sort((a, b) => points[b].z - points[a].z);
    this.hits = [];
    for (const i of this.order) {
      const node = network.nodes[i], p = points[i];
      if (!p.visible || p.x < -60 || p.y < -60 || p.x > width + 60 || p.y > height + 60) continue;
      c.globalAlpha = Math.max(.38, Math.min(1, .88 - p.z * .14));
      c.drawImage(this.sprites[node.color], p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      this.hits.push({ index: i, x: p.x, y: p.y, radius: p.radius });
    }
    c.globalAlpha = 1;
    for (const i of network.hubs) {
      const node = network.nodes[i], p = points[i];
      if (!p.visible) continue;
      const active = scene.active === i;
      this.label(node.label, p.x + p.radius * .6, p.y + p.radius * .45, (active ? 14 : 12) * unit * Math.min(1.7, Math.sqrt(view.zoom)), active ? '#e9c777' : '#eeeae0', i);
    }
    if (activeNode && points[scene.active].visible) {
      const p = points[scene.active];
      c.beginPath(); c.strokeStyle = '#e9c777'; c.lineWidth = 1.5;
      c.arc(p.x, p.y, p.radius + 3, 0, Math.PI * 2); c.stroke();
      if (scene.tooltip) {
        scene.tooltip.style.display = '';
        const cardWidth = Math.min(width - 24, Math.max(180, Math.min(width * .29, 290)));
        scene.tooltip.style.width = `${cardWidth}px`;
        const cardHeight = scene.tooltip.offsetHeight;
        const x = Math.max(12, Math.min(width - cardWidth - 12, p.x + 20 * unit));
        const y = Math.max(36, Math.min(height - cardHeight - 12, p.y - cardHeight - 10));
        scene.tooltip.style.transform = `translate(${x}px,${y}px)`;
      }
    } else if (scene.tooltip) scene.tooltip.style.display = 'none';
    c.globalAlpha = 1;
  }

  private label(text: string, x: number, y: number, size: number, color: string, index: number) {
    const c = this.context; c.font = `600 ${Math.max(7, size)}px ui-monospace, 'SFMono-Regular', Consolas, monospace`;
    const width = c.measureText(text).width + 12 * this.width / 1080, height = Math.max(12, size * 1.65);
    if (x < 0 || y < 0 || x > this.width || y > this.height) return;
    c.fillStyle = '#050908ed'; c.fillRect(x - 3, y - height / 2, width, height);
    c.fillStyle = color; c.fillText(text, x + 2, y + size * .32);
    this.hits.push({ index, x: x - 3, y, radius: 0, width });
  }
}
