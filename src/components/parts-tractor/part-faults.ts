import type { PartsModelId } from './parts-catalog';

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

const t70Wheel: PartExample = check([
  { zh: '胎压不均，行走跑偏', en: 'Uneven pressure pulls the path' },
  { zh: '轮辋螺栓松动', en: 'Loose rim bolts' },
]);
const t70Hub: PartExample = check([
  { zh: '轮毂轴承异响', en: 'Hub bearing is noisy' },
  { zh: '轮毂螺栓力矩不足', en: 'Hub bolts are under-torqued' },
]);
const t70Sensor: PartExample = check([
  { zh: '顶置传感器无回波', en: 'Roof sensor returns no echo' },
  { zh: '镜面遮挡或积尘', en: 'Lens is blocked or dusty' },
]);

/** Example copy for the electric unmanned tractor. Not live telemetry. */
const T70_EXAMPLES: Record<string, PartExample> = {
  battery_box: watch([
    { zh: '电池舱温度偏高', en: 'Battery bay is running hot' },
    { zh: '单体压差偏大', en: 'Cell voltages have drifted apart' },
  ]),
  body_shell: check([
    { zh: '外壳接缝渗水', en: 'Water at a shell seam' },
    { zh: '充电口盖闭合不严', en: 'Charge-port cover does not seat' },
  ]),
  roof_cap: check([
    { zh: '顶盖固定点松动', en: 'Roof fasteners are loose' },
  ]),
  gps_antenna: watch([
    { zh: '定位漂移，差分中断', en: 'Position drifts and corrections drop' },
    { zh: '天线接头松动', en: 'Antenna connector is loose' },
  ]),
  sensor_roof_l: t70Sensor,
  sensor_roof_r: t70Sensor,
  wheel_fl: t70Wheel,
  wheel_fr: t70Wheel,
  wheel_rl: t70Wheel,
  wheel_rr: t70Wheel,
  hub_fl: t70Hub,
  hub_fr: t70Hub,
  hub_rl: t70Hub,
  hub_rr: t70Hub,
};

const TABLES: Record<PartsModelId, Record<string, PartExample>> = {
  diesel: EXAMPLES,
  t70: T70_EXAMPLES,
};

const FAULT_ORDER: Record<PartsModelId, readonly string[]> = {
  diesel: [
    'engine', 'gearbox', 'clutch', 'battery', 'radiator', 'fuel_tank',
    'front_axle', 'hydraulic_lift', 'cab',
    'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
  ],
  t70: [
    'battery_box', 'body_shell', 'roof_cap', 'gps_antenna',
    'sensor_roof_l', 'sensor_roof_r',
    'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
    'hub_fl', 'hub_fr', 'hub_rl', 'hub_rr',
  ],
};

const unmarked: PartExample = { statusZh: '未标注', statusEn: 'Unmarked', faults: [] };

export function partExample(partId: string, model: PartsModelId = 'diesel'): PartExample {
  return TABLES[model][partId] ?? unmarked;
}

/** Stable order for the fault list. Only parts that carry example faults. */
export function faultList(model: PartsModelId = 'diesel'): string[] {
  const table = TABLES[model];
  return FAULT_ORDER[model].filter(id => (table[id]?.faults.length ?? 0) > 0);
}
