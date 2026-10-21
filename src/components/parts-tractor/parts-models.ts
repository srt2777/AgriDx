import { catalogParts, type CatalogPart, type PartsModelId } from './parts-catalog';

export type PartsShowcase = {
  id: PartsModelId;
  titleZh: string;
  titleEn: string;
  summaryZh: string;
  summaryEn: string;
  file: string;
  shotName: string;
  leaderLength: number;
  frameMin: number;
  orbitMin: number;
  camera: readonly [number, number, number];
};

/** New-version studio opens on the Honghu T70. The diesel parts tractor stays one switch away. */
export const DEFAULT_PARTS_MODEL: PartsModelId = 't70';

export const PARTS_SHOWCASE: Record<PartsModelId, PartsShowcase> = {
  t70: {
    id: 't70',
    titleZh: '鸿鹄 T70',
    titleEn: 'Honghu T70',
    summaryZh: '电动无人拖拉机部件示意',
    summaryEn: 'Electric unmanned tractor, parts schematic',
    file: 'models/t70-parts/t70_parts_meshopt.glb',
    shotName: 'agridx-honghu-t70.png',
    leaderLength: 0.2,
    frameMin: 0.32,
    orbitMin: 0.28,
    camera: [2.1, 1.25, 2.1],
  },
  diesel: {
    id: 'diesel',
    titleZh: '柴油部件机',
    titleEn: 'Diesel parts tractor',
    summaryZh: '柴油拖拉机部件示意',
    summaryEn: 'Diesel tractor, parts schematic',
    file: 'models/tractor-parts/tractor_parts.glb',
    shotName: 'agridx-parts-tractor.png',
    leaderLength: 0.42,
    frameMin: 2.4,
    orbitMin: 1.2,
    camera: [4.4, 2.5, 4.4],
  },
};

export const PARTS_MODEL_ORDER: readonly PartsModelId[] = ['t70', 'diesel'];

const T70_TREE: readonly string[] = [
  'body_shell', 'roof_cap', 'battery_box',
  'sensor_roof_l', 'sensor_roof_r', 'gps_antenna',
  'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
  'hub_fl', 'hub_fr', 'hub_rl', 'hub_rr',
];

/** Sidebar order. Diesel keeps the catalog order; T70 reads shell, roof, battery, then sensors and running gear. */
export function orderedParts(model: PartsModelId): CatalogPart[] {
  const parts = [...catalogParts(model)];
  if (model !== 't70') return parts;
  const rank = new Map(T70_TREE.map((id, index) => [id, index]));
  return parts.sort((a, b) => (rank.get(a.partId) ?? 99) - (rank.get(b.partId) ?? 99));
}
