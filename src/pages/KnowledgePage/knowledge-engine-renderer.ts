import type { EngineNetwork, EngineNode } from './knowledge-engine-model';
import type { GraphCamera } from './graph-interaction';
import { graphNodeScale } from './graph-interaction';

export interface EngineHit { index: number; x: number; y: number; radius: number; width?: number }
interface Projected { x: number; y: number; z: number; radius: number; visible: boolean }
export interface EngineScene {
  time: number; active: number; reference: boolean; animate: boolean; cinematic: boolean;
  conflict: boolean; camera: GraphCamera; tooltip: HTMLElement | null;
}
function sphere(color: EngineNode['color'], mesh: boolean) {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
  const c = canvas.getContext('2d')!;
  const gradient = c.createRadialGradient(32, 26, 1, 49, 49, 46);
  const stops = color === 'gold' ? ['#fff1a8', '#efc544', '#bc8c1d', '#40391e'] : color === 'ivory' ? ['#fff9eb', '#d7d4c7', '#9a9c93', '#343b36'] : ['#ffd0bc', '#fb9682', '#c85c53', '#452b28'];
  [0, .32, .7, 1].forEach((stop, i) => gradient.addColorStop(stop, stops[i]));
  c.fillStyle = gradient; c.beginPath(); c.arc(48, 48, 46, 0, Math.PI * 2); c.fill();
  if (mesh) {
    c.save(); c.beginPath(); c.arc(48, 48, 45, 0, Math.PI * 2); c.clip(); c.strokeStyle = '#292c2850'; c.lineWidth = .8;
    for (let i = -3; i <= 3; i++) {
      c.beginPath(); c.ellipse(48, 48, Math.max(2, Math.abs(i) * 13), 46, .38, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.ellipse(48, 48 + i * 12, 46, 13, -.28, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }
  return canvas;
}
/** Perspective canvas renderer; cached shaded sprites keep 3k+ nodes usable without WebGL. */
export class KnowledgeEngineRenderer {
  private context: CanvasRenderingContext2D;
  private sprites = { coral: sphere('coral', false), ivory: sphere('ivory', false), gold: sphere('gold', false) };
  private mesh = { coral: sphere('coral', true), ivory: sphere('ivory', true), gold: sphere('gold', true) };
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
  draw(scene: EngineScene) {
    const { canvas, context: c, network, points } = this;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.width = width; this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#0e1211'; c.fillRect(0, 0, width, height);
    const unit = width / 1080, { camera: view, time } = scene;
    // The camera moves toward the new answer, then returns to the overview for the audit.
    const approach = scene.reference && scene.cinematic ? Math.max(0, Math.min(1, (time - 10) / 2, (14.4 - time) / .6)) : 0;
    const scale = Math.min(width / 5.85, height / 5.65) * view.zoom * (1 + approach * .22);
    const yaw = view.yaw + (scene.animate || scene.reference ? time * .017 : 0);
    const pitch = view.pitch + (scene.animate ? Math.sin(time * .18) * .025 : 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    network.nodes.forEach((node, i) => {
      const point = points[i]; point.visible = !scene.reference || node.born <= time;
      if (!point.visible) return;
      const drift = scene.animate ? Math.sin(time * .35 + node.cluster) * .018 : 0;
      const x = node.x + drift, y = node.y + drift * .5, z = node.z;
      const rx = x * cy + z * sy, rz = -x * sy + z * cy;
      const ry = y * cp - rz * sp, depth = rz * cp + y * sp, perspective = 7 / (7 + depth);
      point.x = width / 2 + rx * scale * perspective + view.panX - approach * width * .13;
      point.y = height * .49 - ry * scale * perspective + view.panY - approach * height * .06;
      point.z = depth;
      const growth = scene.reference && node.born > 0 ? Math.min(1, Math.max(0, (time - node.born) * 3)) : 1;
      point.radius = Math.max(.48 * unit, node.radius * scale * perspective * growth * graphNodeScale(view.zoom));
    });
    c.lineWidth = Math.max(.35, .55 * unit);
    for (let group = 0; group < 2; group++) {
      c.beginPath(); c.strokeStyle = group ? '#b8beb32e' : '#e0837036';
      for (const edge of network.edges) {
        if (scene.reference && edge.born > time) continue;
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
        if (scene.reference && edge.born > time) continue;
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
      c.drawImage((p.radius > 8 * unit ? this.mesh : this.sprites)[node.color], p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
      this.hits.push({ index: i, x: p.x, y: p.y, radius: p.radius });
      if (!node.hub && i % 83 === 0) this.label(node.label, p.x + 3 * unit, p.y + 3 * unit, 8.5 * unit, '#c5c8bd', i);
    }
    c.globalAlpha = 1;
    for (const i of network.hubs) {
      const node = network.nodes[i], p = points[i];
      if (!p.visible) continue;
      const active = scene.active === i;
      const label = active && scene.reference ? `${node.label} / ${i === 12 ? 'LOCKED' : scene.conflict ? 'CONFLICT' : i === 13 ? 'SAVED' : 'PATCH'}` : node.label;
      this.label(label, p.x + p.radius * .6, p.y + p.radius * .45, (active ? 14 : 12) * unit * Math.min(1.7, Math.sqrt(view.zoom)), active ? '#e9c777' : '#eeeae0', i);
    }
    if (activeNode && points[scene.active].visible) {
      const p = points[scene.active];
      const wave = scene.reference ? (time * 1.5) % 1 : (time * .7) % 1;
      if (scene.animate && (scene.reference || wave < .7)) {
        for (let ring = 0; ring < 3; ring++) {
          c.beginPath(); c.strokeStyle = scene.conflict ? `rgba(235,198,94,${(1 - wave) * .6})` : `rgba(246,135,113,${(1 - wave) * .65})`;
          c.lineWidth = (ring === 0 ? 1.8 : .9) * unit;
          c.arc(p.x, p.y, Math.max(p.radius * 1.3, 22 * unit) + (wave * 55 + ring * 9) * unit, 0, Math.PI * 2); c.stroke();
        }
      }
      if (scene.tooltip) {
        scene.tooltip.style.display = '';
        const cardWidth = Math.min(width * .29, 290 * Math.max(.7, unit));
        const x = Math.max(12 * unit, Math.min(width - cardWidth - 12 * unit, p.x + 20 * unit));
        const y = Math.max(45 * unit, Math.min(height - 140 * unit, p.y - 150 * unit));
        scene.tooltip.style.width = `${cardWidth}px`;
        scene.tooltip.style.transform = `translate(${x}px,${y}px)`;
      }
    } else if (scene.tooltip) scene.tooltip.style.display = 'none';
    if (scene.conflict && scene.reference) {
      const p = points[4];
      for (const [dx, dy, label] of [[-110, -35, '042 / DAILY'], [105, -65, '017 / WEEKLY']] as const) {
        const x = p.x + dx * unit, y = p.y + dy * unit;
        c.strokeStyle = '#d8bb6170'; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(x, y); c.stroke();
        c.drawImage(this.sprites.gold, x - 5 * unit, y - 5 * unit, 10 * unit, 10 * unit);
        this.label(label, x + 8 * unit, y, 10 * unit, '#edca73', 4);
      }
    }
    c.globalAlpha = 1; c.strokeStyle = '#aab5a044'; c.lineWidth = .7;
    for (let y = 50 * unit; y < height - 20 * unit; y += 20 * unit) { c.beginPath(); c.moveTo(7 * unit, y); c.lineTo(13 * unit, y); c.stroke(); }
    c.fillStyle = '#e4e8db47'; c.textAlign = 'center'; c.font = `${26 * unit}px ui-monospace, monospace`;
    c.fillText(scene.reference ? 'A R G O N A' : 'A G R I D X', width / 2, height * .87); c.textAlign = 'start';
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
