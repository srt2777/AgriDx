import dieselRaw from '../../../public/models/tractor-parts/parts.json' with { type: 'json' };
import t70Raw from '../../../public/models/t70-parts/parts.json' with { type: 'json' };

export type PartsModelId = 't70' | 'diesel';

type RawNode = {
  name: string;
  label_zh: string;
  part_id: string;
  explode_dir?: number[];
  is_group?: boolean;
  children?: RawNode[];
};

export type CatalogPart = {
  name: string;
  labelZh: string;
  partId: string;
  explodeDir: [number, number, number];
  group: boolean;
  children: CatalogPart[];
};

const SIDE: Record<string, string> = {
  wheel_fl: '左前',
  wheel_fr: '右前',
  wheel_rl: '左后',
  wheel_rr: '右后',
};

const EN_T70: Record<string, string> = {
  battery_box: 'Battery bay',
  body_shell: 'Body shell',
  gps_antenna: 'GPS antenna',
  hub_fl: 'Front-left hub',
  hub_fr: 'Front-right hub',
  hub_rl: 'Rear-left hub',
  hub_rr: 'Rear-right hub',
  roof_cap: 'Roof cap',
  sensor_roof_l: 'Left roof sensor',
  sensor_roof_r: 'Right roof sensor',
  wheel_fl: 'Front-left wheel',
  wheel_fr: 'Front-right wheel',
  wheel_rl: 'Rear-left wheel',
  wheel_rr: 'Rear-right wheel',
};

const EN: Record<string, string> = {
  wheel_fl: 'Front-left tyre',
  wheel_fr: 'Front-right tyre',
  wheel_rl: 'Rear-left tyre',
  wheel_rr: 'Rear-right tyre',
  frame: 'Frame',
  front_axle: 'Front axle',
  engine: 'Engine',
  radiator: 'Radiator',
  battery: 'Battery',
  engine_hood: 'Engine hood',
  headlights: 'Headlights',
  headlights_cab: 'Cab headlights',
  headlights_front_l: 'Front-left headlight',
  headlights_front_r: 'Front-right headlight',
  exhaust: 'Exhaust',
  clutch: 'Clutch',
  gearbox: 'Gearbox',
  rear_axle: 'Rear axle',
  fuel_tank: 'Fuel tank',
  fenders: 'Fenders',
  fender_l: 'Left fender',
  fender_r: 'Right fender',
  cab: 'Cab',
  seat: 'Seat',
  steering_wheel: 'Steering wheel',
  hydraulic_lift: 'Hydraulic lift',
  three_point_hitch: 'Three-point hitch',
  pto: 'PTO shaft',
};

function vec3(value: number[] | undefined): [number, number, number] {
  const x = Number(value?.[0] ?? 0);
  const y = Number(value?.[1] ?? 0);
  const z = Number(value?.[2] ?? 0);
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0];
}

function readNode(node: RawNode): CatalogPart {
  return {
    name: node.name,
    labelZh: node.label_zh,
    partId: node.part_id,
    explodeDir: vec3(node.explode_dir),
    group: node.is_group === true,
    children: (node.children ?? []).map(readNode),
  };
}

const catalogs: Record<PartsModelId, CatalogPart[]> = {
  t70: (t70Raw.parts as RawNode[]).map(readNode),
  diesel: (dieselRaw.parts as RawNode[]).map(readNode),
};

export function catalogParts(model: PartsModelId = 'diesel'): readonly CatalogPart[] {
  return catalogs[model];
}

export function catalogByName(name: string, model: PartsModelId = 'diesel'): { node: CatalogPart; parent: CatalogPart | null } | null {
  for (const part of catalogs[model]) {
    if (part.name === name) return { node: part, parent: null };
    for (const child of part.children) {
      if (child.name === name) return { node: child, parent: part };
    }
  }
  return null;
}

export function resolveSelection(selection: string | null, model: PartsModelId = 'diesel'): { node: CatalogPart; parent: CatalogPart | null } | null {
  if (!selection) return null;
  if (selection.startsWith('group:')) return catalogByName(selection.slice(6), model);
  return catalogByName(selection, model);
}

export function selectionForPart(partId: string, model: PartsModelId = 'diesel'): string {
  const part = catalogs[model].find(item => item.partId === partId);
  if (!part) return partId;
  if (part.group) return `group:${part.name}`;
  return part.name;
}

export function partTitle(node: CatalogPart, lang: 'zh' | 'en', model: PartsModelId = 'diesel'): string {
  const side = model === 'diesel' ? SIDE[node.name] : undefined;
  const zh = side ? `${node.labelZh} · ${side}` : node.labelZh;
  if (lang === 'zh') return zh;
  const table = model === 't70' ? EN_T70 : EN;
  return table[node.name] ?? zh;
}

/** Hover copy keeps the Chinese name stored on the mesh. */
export function hoverLabel(labelZh: string, lang: 'zh' | 'en', name: string, model: PartsModelId = 'diesel'): string {
  if (lang === 'zh') return labelZh;
  const table = model === 't70' ? EN_T70 : EN;
  const en = table[name];
  return en ? `${labelZh} · ${en}` : labelZh;
}
