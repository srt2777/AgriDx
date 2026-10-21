export type PartFault = { zh: string; en: string };

export type PartExample = {
  statusZh: string;
  statusEn: string;
  faults: PartFault[];
};

const watch = (faults: PartFault[]): PartExample => ({ statusZh: '关注', statusEn: 'Watch', faults });
const check = (faults: PartFault[]): PartExample => ({ statusZh: '待检', statusEn: 'Inspect', faults });
const ok: PartExample = { statusZh: '正常', statusEn: 'Normal', faults: [] };

const wheel: PartExample = check([
  { zh: '胎压不均，转向跑偏', en: 'Uneven pressure pulls the steering' },
  { zh: '轮毂螺栓松动', en: 'Loose wheel bolts' },
]);

const EXAMPLES: Record<string, PartExample> = {
  wheel_fl: wheel,
  wheel_fr: wheel,
  wheel_rl: wheel,
  wheel_rr: wheel,
  frame: ok,
  front_axle: check([
    { zh: '前束失准', en: 'Toe is out of adjustment' },
    { zh: '转向节间隙偏大', en: 'Excess knuckle play' },
  ]),
  engine: watch([
    { zh: '启动困难，排烟偏重', en: 'Hard starting and heavy exhaust' },
    { zh: '机油压力偏低', en: 'Low oil pressure' },
    { zh: '冷却液温度升高过快', en: 'Coolant temperature climbs quickly' },
  ]),
  radiator: check([
    { zh: '散热片堵塞', en: 'Clogged fins' },
    { zh: '上水管渗漏', en: 'Upper hose seepage' },
  ]),
  battery: watch([
    { zh: '电压偏低，启动无力', en: 'Low voltage and a weak crank' },
    { zh: '极柱氧化', en: 'Oxidised terminals' },
  ]),
  engine_hood: ok,
  headlights: ok,
  exhaust: ok,
  clutch: check([
    { zh: '分离不彻底', en: 'Does not release fully' },
    { zh: '踏板自由行程过小', en: 'Pedal free play is too small' },
  ]),
  gearbox: watch([
    { zh: '挂挡沉重', en: 'Hard to shift' },
    { zh: '行驶中异响', en: 'Noise while driving' },
  ]),
  rear_axle: ok,
  fuel_tank: check([
    { zh: '油箱通气不畅', en: 'Tank vent is blocked' },
    { zh: '出油口渗漏', en: 'Outlet seepage' },
  ]),
  fenders: ok,
  cab: check([
    { zh: '玻璃起雾，通风不畅', en: 'Glass fogs and ventilation is weak' },
  ]),
  seat: ok,
  steering_wheel: ok,
  hydraulic_lift: check([
    { zh: '提升缓慢', en: 'Lift is slow' },
    { zh: '静置后缓慢下沉', en: 'Drifts down while parked' },
  ]),
  three_point_hitch: ok,
  pto: ok,
};

export function partExample(partId: string): PartExample {
  return EXAMPLES[partId] ?? { statusZh: '未标注', statusEn: 'Unmarked', faults: [] };
}

/** Stable order for the fault list. Only parts that carry example faults. */
export function faultList(): string[] {
  return [
    'engine', 'gearbox', 'clutch', 'battery', 'radiator', 'fuel_tank',
    'front_axle', 'hydraulic_lift', 'cab',
    'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
  ].filter(id => (EXAMPLES[id]?.faults.length ?? 0) > 0);
}
