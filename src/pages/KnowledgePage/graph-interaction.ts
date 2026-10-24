import type { TaxonomyNode } from './knowledge-taxonomy-data';

export interface GraphCamera {
  yaw: number; pitch: number; zoom: number; panX: number; panY: number;
  targetYaw: number; targetPitch: number; targetZoom: number; targetPanX: number; targetPanY: number;
  velocityYaw: number; velocityPitch: number;
}
export function createGraphCamera(): GraphCamera {
  return { yaw: -.13, pitch: -.08, zoom: 1, panX: 0, panY: 0, targetYaw: -.13, targetPitch: -.08, targetZoom: 1, targetPanX: 0, targetPanY: 0, velocityYaw: 0, velocityPitch: 0 };
}
export const graphNodeScale = (zoom: number) => Math.min(2.5, Math.sqrt(Math.max(.4, zoom)));
export const graphLabelScale = (zoom: number) => Math.min(2.2, Math.max(.75, zoom));
export const clampZoom = (value: number) => Math.max(.4, Math.min(12, value));
export function zoomGraph(camera: GraphCamera, factor: number, anchor = { x: 0, y: 0 }) {
  const next = clampZoom(camera.targetZoom * factor), ratio = next / camera.targetZoom;
  camera.targetPanX = anchor.x + (camera.targetPanX - anchor.x) * ratio;
  camera.targetPanY = anchor.y + (camera.targetPanY - anchor.y) * ratio;
  camera.targetZoom = next;
}
export function fitGraph(camera: GraphCamera) {
  camera.targetZoom = 1; camera.targetPanX = 0; camera.targetPanY = 0;
  camera.targetYaw = -.13; camera.targetPitch = -.08;
  camera.velocityYaw = 0; camera.velocityPitch = 0;
}
export function cameraMoving(camera: GraphCamera) {
  return Math.abs(camera.zoom - camera.targetZoom) > .001 || Math.abs(camera.panX - camera.targetPanX) + Math.abs(camera.panY - camera.targetPanY) > .1 || Math.abs(camera.yaw - camera.targetYaw) + Math.abs(camera.pitch - camera.targetPitch) > .0005 || Math.abs(camera.velocityYaw) + Math.abs(camera.velocityPitch) > .002;
}
export function stepGraphCamera(camera: GraphCamera, delta: number, reduced = false) {
  const dt = Math.max(0, Math.min(delta, .06));
  if (reduced) { camera.velocityYaw = 0; camera.velocityPitch = 0; }
  camera.targetYaw += camera.velocityYaw * dt;
  camera.targetPitch = Math.max(-1.2, Math.min(1.2, camera.targetPitch + camera.velocityPitch * dt));
  camera.velocityYaw *= Math.exp(-dt * 7); camera.velocityPitch *= Math.exp(-dt * 7);
  const blend = reduced ? 1 : 1 - Math.exp(-dt * 15);
  camera.yaw += (camera.targetYaw - camera.yaw) * blend;
  camera.pitch += (camera.targetPitch - camera.pitch) * blend;
  camera.zoom += (camera.targetZoom - camera.zoom) * blend;
  camera.panX += (camera.targetPanX - camera.panX) * blend;
  camera.panY += (camera.targetPanY - camera.panY) * blend;
}
export function graphNeighborhood(nodes: TaxonomyNode[], selectedId: string, limit = 10) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const selected = byId.get(selectedId);
  const ancestors: TaxonomyNode[] = [];
  let parent = selected?.parent;
  while (parent && byId.has(parent)) { const node = byId.get(parent)!; ancestors.unshift(node); parent = node.parent; }
  const children = nodes.filter(node => node.parent === selectedId);
  const visibleChildren = children.slice(0, limit);
  return { selected, ancestors, children, visibleChildren, shown: selected ? [...ancestors, selected, ...visibleChildren] : [] };
}
export function relationCoordinates(ancestors: TaxonomyNode[], selected: TaxonomyNode, children: TaxonomyNode[], width: number, height: number) {
  const result = new Map<string, { x: number; y: number }>();
  if (width < 600) {
    ancestors.forEach((node, index) => result.set(node.id, { x: width / 2, y: 35 + index * 42 }));
    const selectedY = 60 + ancestors.length * 42;
    result.set(selected.id, { x: width / 2, y: selectedY });
    children.forEach((node, index) => result.set(node.id, { x: width * (index % 2 ? .73 : .27), y: selectedY + 75 + Math.floor(index / 2) * 49 }));
  } else {
    ancestors.forEach((node, index) => result.set(node.id, { x: width * .18, y: height / 2 + (index - (ancestors.length - 1) / 2) * 76 }));
    result.set(selected.id, { x: width / 2, y: height / 2 });
    children.forEach((node, index) => result.set(node.id, { x: width * .82, y: height / 2 + (index - (children.length - 1) / 2) * 48 }));
  }
  return result;
}
