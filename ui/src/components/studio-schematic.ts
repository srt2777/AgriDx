export type StudioLight = 'day' | 'studio' | 'night';
export type StudioPresentation = 'solid' | 'isolate' | 'xray';

export const STUDIO_LIGHTS = [
  { id: 'day', zh: '日光', en: 'Day' },
  { id: 'studio', zh: '棚拍', en: 'Studio' },
  { id: 'night', zh: '夜间', en: 'Night' },
] as const satisfies readonly { id: StudioLight; zh: string; en: string }[];

export const STUDIO_PRESENTATIONS = [
  { id: 'solid', zh: '实体', en: 'Solid' },
  { id: 'isolate', zh: '隔离', en: 'Isolate' },
  { id: 'xray', zh: '透视', en: 'X-ray' },
] as const satisfies readonly { id: StudioPresentation; zh: string; en: string }[];

/** Normalized envelope for the HUD. 100 is the longest axis. Not millimetres. */
export function schematicSpan(size: { x: number; y: number; z: number }) {
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) return null;
  const scale = 100 / longest;
  return {
    width: Math.round(size.x * scale),
    height: Math.round(size.y * scale),
    length: Math.round(size.z * scale),
  };
}

export const SCHEMATIC_HUD = {
  zh: { title: '结构示意', note: '示意比例，不是毫米或铭牌尺寸' },
  en: { title: 'Structure illustration', note: 'Schematic scale, not millimetres or a plate' },
} as const;

/** Slower than the classic 0.8 so the studio idle reads as a turntable. */
export const STUDIO_TURNTABLE_SPEED = 0.35;

export const STUDIO_LIGHT_LOOK = {
  day: {
    background: '#e8f0ea',
    fog: '#e8f0ea',
    ambient: 0.5,
    hemiSky: '#FFF8E7',
    hemiGround: '#C8B89A',
    hemi: 0.6,
    key: 1.2,
    keyColor: '#fff6ea',
    fill: 0.3,
    fillColor: '#E8D5B7',
    cell: '#d5e0d6',
    section: '#b7c8b8',
  },
  studio: {
    background: '#101820',
    fog: '#101820',
    ambient: 0.35,
    hemiSky: '#e7f4ff',
    hemiGround: '#8fb4c8',
    hemi: 0.7,
    key: 1.45,
    keyColor: '#f4fbff',
    fill: 0.55,
    fillColor: '#7ad7ff',
    cell: '#1c3040',
    section: '#3d6478',
  },
  night: {
    background: '#0b1218',
    fog: '#0b1218',
    ambient: 0.16,
    hemiSky: '#9fd4ff',
    hemiGround: '#1a2836',
    hemi: 0.35,
    key: 0.45,
    keyColor: '#d7ecff',
    fill: 0.7,
    fillColor: '#3ec6ff',
    cell: '#15202a',
    section: '#245066',
  },
} as const satisfies Record<StudioLight, {
  background: string;
  fog: string;
  ambient: number;
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  key: number;
  keyColor: string;
  fill: number;
  fillColor: string;
  cell: string;
  section: string;
}>;

/** Opacity for one part. Schematic only — custom models stay solid. */
export function partOpacity(presentation: StudioPresentation, selected: boolean, viewingAll: boolean, base: number) {
  if (presentation === 'xray') return !viewingAll && selected ? base : 0.22;
  if (presentation === 'isolate' && !viewingAll) return selected ? base : 0;
  if (!viewingAll && !selected) return 0.09;
  return base;
}
