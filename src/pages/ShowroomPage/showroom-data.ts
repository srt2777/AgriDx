/**
 * Showroom data: hall layout, four zones, weather presets, quality tiers and
 * the T70 part catalogue. Pure data + pure helpers so tests can cover the
 * behaviour without a WebGL context.
 *
 * Hall coordinates: metres, x = east, z = south, origin at the hall centre
 * (the T70 platform). Hall interior is 44 m (x) x 30 m (z); the drivable
 * main aisle runs along x at z = 0 with a 6 m clear width.
 */

/** Hall interior half-extents (metres). Walls sit just outside these. */
export const HALL = { halfX: 22, halfZ: 15, height: 7 } as const;

/** Static axis-aligned obstacles the walker / vehicle must not pass through. */
export interface HallObstacle {
  id: string;
  /** [minX, minZ, maxX, maxZ] footprint in metres. */
  box: [number, number, number, number];
  label: string;
}

export const HALL_OBSTACLES: HallObstacle[] = [
  { id: 't70-platform', box: [-3.4, -2.2, 3.4, 2.2], label: 'T70 中央展台' },
  { id: 'diag-booth', box: [13.5, -12.5, 19.5, -7.5], label: '诊断工位' },
  { id: 'embodied-booth', box: [-19.5, -12.5, -13.5, -7.5], label: '具身装备展台' },
  { id: 'kiosk', box: [13.5, 7.5, 19.5, 12.5], label: 'AgriDx 交互大屏' },
  { id: 'planter-nw', box: [-20.5, -13.5, -18.5, -11.5], label: '绿植角' },
  { id: 'planter-ne', box: [18.5, -13.5, 20.5, -11.5], label: '绿植角' },
  { id: 'planter-sw', box: [-20.5, 11.5, -18.5, 13.5], label: '绿植角' },
  { id: 'planter-se', box: [18.5, 11.5, 20.5, 13.5], label: '绿植角' },
];

export type ZoneId = 'tractor' | 'diagnosis' | 'embodied' | 'agridex';

export interface ShowroomZone {
  id: ZoneId;
  zh: string;
  en: string;
  /** Camera stand-off point for the fly-in (metres). */
  camera: [number, number, number];
  /** Point the camera looks at on arrival. */
  lookAt: [number, number, number];
  /** Where the tractor parks for auto-navigation (metres, x/z). */
  dock: [number, number];
  /** Where the walker stands after a fly-in. */
  stand: [number, number];
  color: string;
  taglineZh: string;
  taglineEn: string;
  bodyZh: string;
  bodyEn: string;
}

export const SHOWROOM_ZONES: ShowroomZone[] = [
  {
    id: 'tractor',
    zh: '智能拖拉机展区',
    en: 'Smart Tractor',
    camera: [7.5, 2.6, 7.5],
    lookAt: [0, 1.1, 0],
    dock: [7.2, 0],
    stand: [6.5, 5.5],
    color: '#2e7d46',
    taglineZh: '鸿鹄 T70 · 中央主展区',
    taglineEn: 'Honghu T70 · Main exhibit',
    bodyZh: '鸿鹄 T70 智能拖拉机：北斗定位、激光雷达与多路摄像头协同感知，农业绿与白色涂装，车漆带清漆层高光。点击车身传感器热点查看标注；按 E 上车驾驶，车轮转动、方向盘联动。',
    bodyEn: 'The Honghu T70 smart tractor: BeiDou positioning, lidar and cameras sensing together. Tap a sensor hotspot for its label; press E to drive — wheels turn and the steering follows.',
  },
  {
    id: 'diagnosis',
    zh: '故障诊断机器人展区',
    en: 'Diagnosis Robot',
    camera: [16.5, 2.4, -5.2],
    lookAt: [16.5, 1.0, -10],
    dock: [16.5, -5.2],
    stand: [14.2, -5.2],
    color: '#245d7d',
    taglineZh: '检测 — 定位 — 诊断',
    taglineEn: 'Detect — Locate — Diagnose',
    bodyZh: '诊断机器人配检修工位：机械臂携带检测头沿预设路径扫描机身，依次完成检测、定位、诊断三步，状态灯带同步显示进度。',
    bodyEn: 'A diagnosis robot at a service bay: its arm sweeps the machine on a set path through detect, locate and diagnose, with the status light strip following each step.',
  },
  {
    id: 'embodied',
    zh: '农业具身智能装备展区',
    en: 'Embodied Agri-Robot',
    camera: [-16.5, 2.4, -5.2],
    lookAt: [-16.5, 1.0, -10],
    dock: [-16.5, -5.2],
    stand: [-14.2, -5.2],
    color: '#886423',
    taglineZh: '具身智能 · 机械臂',
    taglineEn: 'Embodied intelligence · Robot arm',
    bodyZh: '农业具身智能机器人与六轴机械臂：模型展台与展板并列，机械臂循环演示采摘抓取动作，展板介绍感知—决策—执行闭环。',
    bodyEn: 'An embodied agricultural robot with a six-axis arm: a model plinth beside an info board, the arm looping a pick-and-place demo of the sense–decide–act loop.',
  },
  {
    id: 'agridex',
    zh: 'AgriDx 智能诊断交互区',
    en: 'AgriDx Interactive',
    camera: [16.5, 2.4, 5.2],
    lookAt: [16.5, 1.4, 10],
    dock: [16.5, 5.2],
    stand: [14.2, 5.2],
    color: '#1f7a6d',
    taglineZh: '大屏交互台 · 真实诊断接口',
    taglineEn: 'Interactive wall · Live diagnosis API',
    bodyZh: '大屏交互台接入站内 AgriDx 诊断接口（/api/chat）：输入故障现象，知识库检索后给出诊断结果与维修建议；也可点预设问题一键演示，演示数据均有标注。',
    bodyEn: 'The interactive wall calls the live AgriDx diagnosis API (/api/chat): describe a fault and get a knowledge-backed diagnosis with repair advice, or tap a preset question for a one-tap demo. Demo data is always labelled.',
  },
];

export function zoneById(id: ZoneId): ShowroomZone {
  return SHOWROOM_ZONES.find((zone) => zone.id === id) ?? SHOWROOM_ZONES[0];
}

/* ------------------------------------------------------------------ */
/* Weather                                                             */
/* ------------------------------------------------------------------ */

export type WeatherId = 'sunny' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'storm' | 'snow';

export interface WeatherPreset {
  id: WeatherId;
  zh: string;
  en: string;
  icon: string;
  tempC: number;
  humidity: number;
  windKmh: number;
  windDir: string;
  precipitationMm: number;
  /** Sky dome top / horizon colours. */
  skyTop: string;
  skyHorizon: string;
  /** Sun / key-light intensity multiplier (1 = clear noon). */
  sun: number;
  /** Interior fill-light multiplier (lamps compensate on grey days). */
  lamps: number;
  /** Fog density (scene units). 0 = clear. */
  fog: number;
  /** Rain/snow particle count (0 = none). */
  particles: number;
  /** 0 = rain, 1 = snow. */
  particleKind: 'rain' | 'snow' | 'none';
  /** Window droplet coverage 0..1. */
  droplets: number;
  /** Cloud cover 0..1 (drifting billboards outside the windows). */
  clouds: number;
  /** Daytime ambience (not a real forecast value — panel copy). */
  noteZh: string;
  noteEn: string;
}

export const WEATHER_PRESETS: WeatherPreset[] = [
  { id: 'sunny', zh: '晴', en: 'Sunny', icon: '☀️', tempC: 26, humidity: 42, windKmh: 8, windDir: '东南', precipitationMm: 0, skyTop: '#7db8e8', skyHorizon: '#dceefb', sun: 1, lamps: 0.55, fog: 0, particles: 0, particleKind: 'none', droplets: 0, clouds: 0.15, noteZh: '光照充足，适合田间作业', noteEn: 'Bright and clear, good for field work' },
  { id: 'cloudy', zh: '多云', en: 'Cloudy', icon: '⛅', tempC: 24, humidity: 55, windKmh: 12, windDir: '东', precipitationMm: 0, skyTop: '#8fb4d4', skyHorizon: '#e3e9ee', sun: 0.75, lamps: 0.7, fog: 0.004, particles: 0, particleKind: 'none', droplets: 0, clouds: 0.55, noteZh: '云量较多，光照尚可', noteEn: 'Partly cloudy, light still fair' },
  { id: 'overcast', zh: '阴', en: 'Overcast', icon: '☁️', tempC: 21, humidity: 68, windKmh: 10, windDir: '东北', precipitationMm: 0, skyTop: '#9aa5ad', skyHorizon: '#d7dde0', sun: 0.45, lamps: 0.9, fog: 0.01, particles: 0, particleKind: 'none', droplets: 0, clouds: 0.85, noteZh: '光照偏弱，留意湿度上升', noteEn: 'Dim light, humidity rising' },
  { id: 'fog', zh: '雾', en: 'Foggy', icon: '🌫️', tempC: 18, humidity: 92, windKmh: 4, windDir: '北', precipitationMm: 0, skyTop: '#b9c0c2', skyHorizon: '#e6e8e6', sun: 0.25, lamps: 1, fog: 0.045, particles: 0, particleKind: 'none', droplets: 0.25, clouds: 0.4, noteZh: '能见度低，雾气贴地', noteEn: 'Low visibility, ground fog' },
  { id: 'rain', zh: '小雨', en: 'Light rain', icon: '🌦️', tempC: 19, humidity: 85, windKmh: 14, windDir: '东南', precipitationMm: 2.4, skyTop: '#7e93a6', skyHorizon: '#ccd5d8', sun: 0.35, lamps: 1, fog: 0.016, particles: 900, particleKind: 'rain', droplets: 0.7, clouds: 0.9, noteZh: '小雨，雨滴附着窗玻璃', noteEn: 'Light rain, droplets on the glass' },
  { id: 'storm', zh: '大雨', en: 'Heavy rain', icon: '🌧️', tempC: 17, humidity: 94, windKmh: 28, windDir: '南', precipitationMm: 12.8, skyTop: '#5d6d7c', skyHorizon: '#aeb9bd', sun: 0.2, lamps: 1.15, fog: 0.022, particles: 2200, particleKind: 'rain', droplets: 1, clouds: 1, noteZh: '大雨，不宜出车作业', noteEn: 'Heavy rain, do not send machines out' },
  { id: 'snow', zh: '雪', en: 'Snow', icon: '❄️', tempC: -2, humidity: 78, windKmh: 9, windDir: '西北', precipitationMm: 3.1, skyTop: '#aebac4', skyHorizon: '#e8ebec', sun: 0.4, lamps: 1, fog: 0.014, particles: 1400, particleKind: 'snow', droplets: 0, clouds: 0.9, noteZh: '降雪，路面湿滑', noteEn: 'Snowfall, slippery ground' },
];

export function weatherById(id: WeatherId): WeatherPreset {
  return WEATHER_PRESETS.find((w) => w.id === id) ?? WEATHER_PRESETS[0];
}

/** 农机作业适宜度：仅供展厅面板参考的简化规则（温度 / 降水 / 风速）。 */
export type Suitability = 'good' | 'caution' | 'bad';
export function suitabilityFor(preset: WeatherPreset): Suitability {
  if (preset.precipitationMm >= 10 || preset.windKmh >= 25) return 'bad';
  if (preset.precipitationMm >= 1 || preset.humidity >= 85 || preset.tempC <= 0) return 'caution';
  return 'good';
}

export const SUITABILITY_COPY: Record<Suitability, { zh: string; en: string }> = {
  good: { zh: '适宜', en: 'Good to go' },
  caution: { zh: '谨慎', en: 'Use caution' },
  bad: { zh: '不宜', en: 'Not advised' },
};

/** Deterministic 24 h trend (hour offsets from "now") for the panel. */
export function forecast24h(preset: WeatherPreset): { hour: number; tempC: number; precipMm: number }[] {
  const out: { hour: number; tempC: number; precipMm: number }[] = [];
  for (let h = 0; h < 24; h += 3) {
    const wave = Math.sin((h / 24) * Math.PI * 2 - Math.PI / 2);
    out.push({
      hour: h,
      tempC: Math.round((preset.tempC + wave * 3.5) * 10) / 10,
      precipMm: Math.max(0, Math.round((preset.precipitationMm * (0.6 + 0.4 * Math.cos(h / 6))) * 10) / 10),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Quality tiers                                                       */
/* ------------------------------------------------------------------ */

export type QualityId = 'high' | 'medium' | 'low';
export interface QualityTier {
  id: QualityId;
  zh: string;
  en: string;
  pixelRatio: number;
  shadows: boolean;
  post: 'full' | 'bloom' | 'none';
  particles: number;
}
export const QUALITY_TIERS: Record<QualityId, QualityTier> = {
  high: { id: 'high', zh: '高', en: 'High', pixelRatio: 2, shadows: true, post: 'full', particles: 1 },
  medium: { id: 'medium', zh: '中', en: 'Medium', pixelRatio: 1.5, shadows: true, post: 'bloom', particles: 0.6 },
  low: { id: 'low', zh: '低', en: 'Low', pixelRatio: 1, shadows: false, post: 'none', particles: 0.3 },
};

/* ------------------------------------------------------------------ */
/* T70 parts (from public/models/t70-parts/parts.json — the 14 real     */
/* segmented parts only; no engine/gearbox parts are invented).        */
/* ------------------------------------------------------------------ */

export interface T70PartInfo {
  id: string;
  zh: string;
  en: string;
  /** Whether this part gets a clickable sensor hotspot. */
  hotspot: boolean;
  detailZh: string;
  detailEn: string;
}

export const T70_PARTS: T70PartInfo[] = [
  { id: 'gps_antenna', zh: '北斗天线', en: 'BeiDou antenna', hotspot: true, detailZh: '北斗高精度定位天线，厘米级定位，作业路径与自动导航的基础。', detailEn: 'BeiDou high-precision antenna for centimetre-level positioning — the basis for path planning and auto-navigation.' },
  { id: 'sensor_roof_l', zh: '左顶传感器', en: 'Left roof sensor', hotspot: true, detailZh: '车顶左侧感知单元（激光雷达/摄像头），扫描周围环境与障碍。', detailEn: 'Left roof perception unit (lidar/camera) scanning the surroundings and obstacles.' },
  { id: 'sensor_roof_r', zh: '右顶传感器', en: 'Right roof sensor', hotspot: true, detailZh: '车顶右侧感知单元，与左侧协同形成 360° 感知覆盖。', detailEn: 'Right roof perception unit; together with the left it covers 360°.' },
  { id: 'roof_cap', zh: '车顶盖', en: 'Roof cap', hotspot: false, detailZh: '驾驶舱顶盖，集成天线与传感器支座。', detailEn: 'Cab roof cap carrying the antenna and sensor mounts.' },
  { id: 'body_shell', zh: '车身外壳', en: 'Body shell', hotspot: false, detailZh: '农业绿与白色涂装，清漆层高光；金属、玻璃质感分明。', detailEn: 'Agri-green and white paint with a clearcoat highlight; metal and glass read distinctly.' },
  { id: 'battery_box', zh: '电池舱', en: 'Battery box', hotspot: true, detailZh: '动力电池舱，纯电驱动的能量来源，位于车身中部。', detailEn: 'Battery bay — the energy source of the electric drive, amidships.' },
  { id: 'wheel_fl', zh: '左前轮', en: 'Front-left wheel', hotspot: false, detailZh: '前轮，转向轮；驾驶时随方向盘联动。', detailEn: 'Front wheel (steered); follows the steering wheel while driving.' },
  { id: 'wheel_fr', zh: '右前轮', en: 'Front-right wheel', hotspot: false, detailZh: '前轮，转向轮；驾驶时随方向盘联动。', detailEn: 'Front wheel (steered); follows the steering wheel while driving.' },
  { id: 'wheel_rl', zh: '左后轮', en: 'Rear-left wheel', hotspot: false, detailZh: '后轮，驱动轮；轮胎花纹提供田间抓地力。', detailEn: 'Rear drive wheel; the tread gives grip in the field.' },
  { id: 'wheel_rr', zh: '右后轮', en: 'Rear-right wheel', hotspot: false, detailZh: '后轮，驱动轮；轮胎花纹提供田间抓地力。', detailEn: 'Rear drive wheel; the tread gives grip in the field.' },
  { id: 'hub_fl', zh: '左前轮毂', en: 'Front-left hub', hotspot: false, detailZh: '前轮轮毂。', detailEn: 'Front wheel hub.' },
  { id: 'hub_fr', zh: '右前轮毂', en: 'Front-right hub', hotspot: false, detailZh: '前轮轮毂。', detailEn: 'Front wheel hub.' },
  { id: 'hub_rl', zh: '左后轮毂', en: 'Rear-left hub', hotspot: false, detailZh: '后轮轮毂。', detailEn: 'Rear wheel hub.' },
  { id: 'hub_rr', zh: '右后轮毂', en: 'Rear-right hub', hotspot: false, detailZh: '后轮轮毂。', detailEn: 'Rear wheel hub.' },
];

export function t70PartById(id: string): T70PartInfo | undefined {
  return T70_PARTS.find((part) => part.id === id);
}

/** GLB node names use the Blender source-part ids; match either name. */
export const T70_PART_SOURCES: Record<string, string> = {
  battery_box: 'part_8',
  body_shell: 'part_4',
  gps_antenna: 'part_10',
  hub_fl: 'part_12',
  hub_fr: 'part_1',
  hub_rl: 'part_13',
  hub_rr: 'part_7',
  roof_cap: 'part_5',
  sensor_roof_l: 'part_0',
  sensor_roof_r: 'part_6',
  wheel_fl: 'part_2',
  wheel_fr: 'part_9',
  wheel_rl: 'part_3',
  wheel_rr: 'part_11',
};
