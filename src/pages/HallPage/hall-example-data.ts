/** 展厅运行环和设备表的界面演示。不是传感器、在线监测或实车数字孪生。 */

export type HallZoneId = 'A' | 'B' | 'C' | 'D';
export type HallDeviceStatus = 'online' | 'standby' | 'maintenance' | 'offline';

export const HALL_EXAMPLE_LABEL = '示例数据';

export function exampleDataLabel(lang: 'zh' | 'en'): string {
  return lang === 'zh' ? HALL_EXAMPLE_LABEL : 'Example data';
}

export const HALL_ZONES = [
  {
    id: 'A',
    zh: '动力与智能农机',
    en: 'Power & smart machines',
    blurbZh: '拖拉机与动力平台的结构示意展位。',
    blurbEn: 'Schematic stands for tractors and power platforms.',
    position: [-5.4, 0, -3.15] as [number, number, number],
    color: '#3ec6ff',
  },
  {
    id: 'B',
    zh: '耕作播种',
    en: 'Tillage & seeding',
    blurbZh: '耕整、播种机具的分区浏览。',
    blurbEn: 'Grouped viewing for tillage and seeding implements.',
    position: [5.4, 0, -3.15] as [number, number, number],
    color: '#7dffa8',
  },
  {
    id: 'C',
    zh: '收获植保',
    en: 'Harvest & crop care',
    blurbZh: '收获与植保装备的示意陈列。',
    blurbEn: 'Schematic display for harvest and crop-care equipment.',
    position: [-5.4, 0, 3.35] as [number, number, number],
    color: '#ffd36a',
  },
  {
    id: 'D',
    zh: '智慧农业',
    en: 'Smart agriculture',
    blurbZh: '导航与智慧农业目录的入口展位。',
    blurbEn: 'Entry stand for guidance and smart-agriculture records.',
    position: [5.4, 0, 3.35] as [number, number, number],
    color: '#c9b6ff',
  },
] as const;

export const HALL_STATUS_EXAMPLE = [
  { id: 'online', zh: '在线', en: 'Online', count: 8 },
  { id: 'standby', zh: '待机', en: 'Standby', count: 2 },
  { id: 'maintenance', zh: '维护', en: 'Maintenance', count: 1 },
  { id: 'offline', zh: '离线', en: 'Offline', count: 1 },
] as const satisfies readonly { id: HallDeviceStatus; zh: string; en: string; count: number }[];

export const HALL_EXAMPLE_TOTAL = HALL_STATUS_EXAMPLE.reduce((sum, item) => sum + item.count, 0);

export interface HallExampleDevice {
  id: string;
  zone: HallZoneId;
  name: string;
  manager: string;
  status: HallDeviceStatus;
  specZh: string;
  specEn: string;
}

/** 十二台演示机具，状态计数与运行环一致。名称只用于界面样例。 */
export const HALL_EXAMPLE_DEVICES: readonly HallExampleDevice[] = [
  { id: 'a1', zone: 'A', name: '东方红 LX2204', manager: '周宁', status: 'online', specZh: '示例 · 220 马力', specEn: 'Example · 220 hp' },
  { id: 'a2', zone: 'A', name: '约翰迪尔 6M-2104', manager: '陈可', status: 'online', specZh: '示例 · 210 马力', specEn: 'Example · 210 hp' },
  { id: 'a3', zone: 'A', name: '雷沃 P7000', manager: '林夏', status: 'online', specZh: '示例 · 200 马力', specEn: 'Example · 200 hp' },
  { id: 'b1', zone: 'B', name: '沃得 2BF-24', manager: '赵敏', status: 'online', specZh: '示例 · 24 行', specEn: 'Example · 24 rows' },
  { id: 'b2', zone: 'B', name: '雷沃 M2004', manager: '李航', status: 'standby', specZh: '示例 · 200 马力', specEn: 'Example · 200 hp' },
  { id: 'b3', zone: 'B', name: '气吸播种机 24 行', manager: '马超', status: 'online', specZh: '示例 · 24 行', specEn: 'Example · 24 rows' },
  { id: 'c1', zone: 'C', name: '久保田 PRO688Q', manager: '孙磊', status: 'maintenance', specZh: '示例 · 收获示意', specEn: 'Example · harvest schematic' },
  { id: 'c2', zone: 'C', name: '约翰迪尔 S760', manager: '吴迪', status: 'online', specZh: '示例 · 收获示意', specEn: 'Example · harvest schematic' },
  { id: 'c3', zone: 'C', name: '雷沃谷神 GE80', manager: '韩雪', status: 'online', specZh: '示例 · 收获示意', specEn: 'Example · harvest schematic' },
  { id: 'd1', zone: 'D', name: '植保无人机 T60', manager: '郑洁', status: 'offline', specZh: '示例 · 植保示意', specEn: 'Example · crop-care schematic' },
  { id: 'd2', zone: 'D', name: '导航示范终端', manager: '何川', status: 'online', specZh: '示例 · 导航示意', specEn: 'Example · guidance schematic' },
  { id: 'd3', zone: 'D', name: '田间监测小车', manager: '周倩', status: 'standby', specZh: '示例 · 监测示意', specEn: 'Example · monitor schematic' },
];

export function hallStatusCount(status: HallDeviceStatus): number {
  return HALL_EXAMPLE_DEVICES.filter((device) => device.status === status).length;
}
