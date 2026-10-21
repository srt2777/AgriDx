import raw from '../../../public/models/tractor-parts/parts.json' with { type: 'json' };

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

const parts = (raw.parts as RawNode[]).map(readNode);

export function catalogParts(): readonly CatalogPart[] {
  return parts;
}

export function catalogByName(name: string): { node: CatalogPart; parent: CatalogPart | null } | null {
  for (const part of parts) {
    if (part.name === name) return { node: part, parent: null };
    for (const child of part.children) {
      if (child.name === name) return { node: child, parent: part };
    }
  }
  return null;
}

export function resolveSelection(selection: string | null): { node: CatalogPart; parent: CatalogPart | null } | null {
  if (!selection) return null;
  if (selection.startsWith('group:')) return catalogByName(selection.slice(6));
  return catalogByName(selection);
}

export function selectionForPart(partId: string): string {
  const part = parts.find(item => item.partId === partId);
  if (!part) return partId;
  if (part.group) return `group:${part.name}`;
  return part.name;
}

export function partTitle(node: CatalogPart, lang: 'zh' | 'en'): string {
  const side = SIDE[node.name];
  const zh = side ? `${node.labelZh} · ${side}` : node.labelZh;
  if (lang === 'zh') return zh;
  return EN[node.name] ?? zh;
}

/** Hover copy keeps the Chinese name stored on the mesh. */
export function hoverLabel(labelZh: string, lang: 'zh' | 'en', name: string): string {
  if (lang === 'zh') return labelZh;
  const en = EN[name];
  return en ? `${labelZh} · ${en}` : labelZh;
}
