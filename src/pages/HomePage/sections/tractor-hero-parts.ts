import type { TractorComponent } from '../../../components/tractor-model-info';

/** 零件到七组部件的归属，依据仓库 tractor-model-info 的七组划分，不虚构新组。 */
const GROUP_BY_PART: Record<string, TractorComponent> = {
  engine: 'engine',
  radiator: 'engine',
  engine_hood: 'engine',
  exhaust: 'engine',
  frame: 'drivetrain',
  front_axle: 'drivetrain',
  rear_axle: 'drivetrain',
  clutch: 'drivetrain',
  gearbox: 'drivetrain',
  pto: 'drivetrain',
  hydraulic_lift: 'hydraulics',
  three_point_hitch: 'hydraulics',
  battery: 'electrical',
  headlights: 'electrical',
  headlights_cab: 'electrical',
  headlights_front_l: 'electrical',
  headlights_front_r: 'electrical',
  wheel_fl: 'wheels',
  wheel_fr: 'wheels',
  wheel_rl: 'wheels',
  wheel_rr: 'wheels',
  fenders: 'wheels',
  fender_l: 'wheels',
  fender_r: 'wheels',
  cab: 'cab',
  seat: 'cab',
  steering_wheel: 'cab',
  fuel_tank: 'body',
};

const SIDE: Record<string, string> = {
  wheel_fl: '左前',
  wheel_fr: '右前',
  wheel_rl: '左后',
  wheel_rr: '右后',
};

export function partGroup(name: string): TractorComponent {
  return GROUP_BY_PART[name] ?? 'all';
}

/** 轮胎四个节点在零件目录里都叫“轮胎”，用目录里的方位加以区分。 */
export function partChipLabel(name: string, labelZh: string): string {
  const side = SIDE[name];
  return side ? `${labelZh} · ${side}` : labelZh;
}
