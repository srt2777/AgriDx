/**
 * Showroom data: farm field layout, four zones, weather presets, quality
 * tiers and the T70 part catalogue. Pure data + pure helpers so tests can
 * cover the behaviour without a WebGL context.
 *
 * Field coordinates: metres, x = east, z = south, origin at the field
 * centre (the T70 on the dirt track). The showroom is an open-air farm
 * field — no buildings at all: the drivable dirt track runs along x at
 * z = 0 with a 6 m clear width, crop rows fill the field north and south
 * of the track, and the four zones sit on the field as open-air booths.
 */

/** Field half-extents (metres). The field edge (fence/treeline) sits here. */
export const FIELD = { halfX: 30, halfZ: 22, height: 7 } as const;

/**
 * Surface grip 0..1 from the blended weather: wet ground is slightly
 * slippery, snow considerably more so. Dry = 1.
 */
export function gripForWeather(wet: number, snow: number): number {
  return Math.max(0.5, 1 - 0.15 * Math.max(0, Math.min(1, wet)) - 0.35 * Math.max(0, Math.min(1, snow)));
}

/* ------------------------------------------------------------------ */
/* Terrain + crop plots                                                */
/* ------------------------------------------------------------------ */

/** Gentle field undulation (metres). Flat on the dirt track. */
export function terrainHeight(x: number, z: number): number {
  const raw = 0.45 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.05) + 0.25 * Math.sin(x * 0.15) * Math.sin(z * 0.11 + 0.7);
  // Fade to 0 on the track (|z|<4).
  const smooth = (t: number) => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
  };
  const trackFade = smooth((Math.abs(z) - 4) / 3);
  return raw * trackFade;
}

export type CropKind = 'rice' | 'wheat' | 'corn';

export interface CropPlot {
  id: string;
  crop: CropKind;
  zh: string;
  /** Growth stage 0..1 (0 = seedling, 1 = mature). Drives plant height. */
  stage: number;
  /** [minX, minZ, maxX, maxZ] in metres. */
  bounds: [number, number, number, number];
  /** Row spacing (m) along x and between rows (m) along z. */
  spacing: [number, number];
}

/**
 * Six plots in the field (the dirt track z ∈ [-3, 3] and the three
 * outdoor booths stay clear). Rice / wheat / corn at different growth
 * stages, so the field reads as several crops, not one repeating stamp.
 */
export const CROP_PLOTS: CropPlot[] = [
  { id: 'rice-nw', crop: 'rice', zh: '水稻 · 分蘖期', stage: 0.45, bounds: [-28, -20, -16, -8], spacing: [0.45, 0.75] },
  { id: 'wheat-ne', crop: 'wheat', zh: '小麦 · 灌浆期', stage: 0.8, bounds: [16, -20, 28, -8], spacing: [0.55, 0.9] },
  { id: 'corn-sw', crop: 'corn', zh: '玉米 · 拔节期', stage: 0.65, bounds: [-28, 8, -16, 20], spacing: [0.75, 1.0] },
  { id: 'rice-se', crop: 'rice', zh: '水稻 · 抽穗期', stage: 0.6, bounds: [16, 8, 28, 20], spacing: [0.45, 0.75] },
  { id: 'wheat-n', crop: 'wheat', zh: '小麦 · 苗期', stage: 0.35, bounds: [-12, -17, 12, -8], spacing: [0.55, 0.9] },
  { id: 'corn-s', crop: 'corn', zh: '玉米 · 成熟期', stage: 0.9, bounds: [-12, 8, 12, 17], spacing: [0.75, 1.0] },
];

/** Which plot (if any) covers (x, z). */
export function cropPlotAt(x: number, z: number): CropPlot | undefined {
  return CROP_PLOTS.find((plot) => {
    const [minX, minZ, maxX, maxZ] = plot.bounds;
    return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  });
}

/** Plant height (m) for a crop at a growth stage. */
export function cropHeight(crop: CropKind, stage: number): number {
  const base = crop === 'corn' ? 2.1 : crop === 'rice' ? 0.9 : 1.25;
  return base * (0.35 + 0.65 * Math.max(0, Math.min(1, stage)));
}

/** Approximate plant count per plot at full density (used for budgets). */
export function cropPlotCount(plot: CropPlot): number {
  const [minX, minZ, maxX, maxZ] = plot.bounds;
  return Math.floor(((maxX - minX) / plot.spacing[0]) * ((maxZ - minZ) / plot.spacing[1]));
}

/** Static axis-aligned obstacles the vehicle must not pass through. */
export interface FieldObstacle {
  id: string;
  /** [minX, minZ, maxX, maxZ] footprint in metres. */
  box: [number, number, number, number];
  label: string;
}

export const FIELD_OBSTACLES: FieldObstacle[] = [
  { id: 'diag-booth', box: [13.5, -12.5, 19.5, -7.5], label: '诊断工位' },
  { id: 'embodied-booth', box: [-19.5, -12.5, -13.5, -7.5], label: '具身装备展台' },
  { id: 'kiosk', box: [13.5, 7.5, 19.5, 12.5], label: 'AgriDx 交互大屏' },
  // Crop rows are soft: the tractor may push through the crops.
];

export type ZoneId = 'tractor' | 'diagnosis' | 'embodied' | 'agridex';

export interface ShowroomZone {
  id: ZoneId;
  zh: string;
  en: string;
  /** Where the tractor parks for auto-navigation (metres, x/z). */
  dock: [number, number];
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
    dock: [7.2, 0],
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
    dock: [16.5, -5.2],
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
    dock: [-16.5, -5.2],
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
    dock: [16.5, 5.2],
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

export type WeatherId =
  | 'sunny'
  | 'cloudy'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'moderate'
  | 'storm'
  | 'windy'
  | 'snow';

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
  /** Fill-light multiplier (grey days get a little extra fill). */
  lamps: number;
  /** Fog density (scene units). 0 = clear. */
  fog: number;
  /** Rain/snow particle count (0 = none). */
  particles: number;
  /** 0 = rain, 1 = snow. */
  particleKind: 'rain' | 'snow' | 'none';
  /** Screen droplet coverage 0..1 (rain on the camera / screen). */
  droplets: number;
  /** Cloud cover 0..1 (drifting billboards in the sky). */
  clouds: number;
  /** Crop sway amplitude 0..1 (wind bending the crops). */
  sway: number;
  /** Ground / crop wetness 0..1 (rain darkens soil and crops). */
  wet: number;
  /** Snow cover 0..1 (snow whitens ground/crops and the cab roof, and bends crops down). */
  snow: number;
  /** Wind direction in degrees (0 = from the north, clockwise). */
  windDeg: number;
  /** Daytime ambience (not a real forecast value — panel copy). */
  noteZh: string;
  noteEn: string;
}

export const WEATHER_PRESETS: WeatherPreset[] = [
  { id: 'sunny', zh: '晴', en: 'Sunny', icon: '☀️', tempC: 26, humidity: 42, windKmh: 8, windDir: '东南', precipitationMm: 0, skyTop: '#4f9fe0', skyHorizon: '#cfe9fb', sun: 1, lamps: 0.55, fog: 0, particles: 0, particleKind: 'none', droplets: 0, clouds: 0.15, sway: 0.15, wet: 0, snow: 0, windDeg: 135, noteZh: '艳阳高照，光照充足，适合田间作业', noteEn: 'Bright sun, good for field work' },
  { id: 'cloudy', zh: '多云', en: 'Cloudy', icon: '⛅', tempC: 24, humidity: 55, windKmh: 12, windDir: '东', precipitationMm: 0, skyTop: '#8fb4d4', skyHorizon: '#e3e9ee', sun: 0.75, lamps: 0.7, fog: 0.004, particles: 0, particleKind: 'none', droplets: 0, clouds: 0.55, sway: 0.25, wet: 0, snow: 0, windDeg: 90, noteZh: '云量较多，光照尚可', noteEn: 'Partly cloudy, light still fair' },
  { id: 'overcast', zh: '阴', en: 'Overcast', icon: '☁️', tempC: 21, humidity: 68, windKmh: 10, windDir: '东北', precipitationMm: 0, skyTop: '#9aa5ad', skyHorizon: '#d7dde0', sun: 0.45, lamps: 0.9, fog: 0.01, particles: 0, particleKind: 'none', droplets: 0, clouds: 0.85, sway: 0.25, wet: 0.05, snow: 0, windDeg: 45, noteZh: '光照偏弱，留意湿度上升', noteEn: 'Dim light, humidity rising' },
  { id: 'fog', zh: '雾', en: 'Foggy', icon: '🌫️', tempC: 18, humidity: 92, windKmh: 4, windDir: '北', precipitationMm: 0, skyTop: '#aab0b2', skyHorizon: '#dde0dd', sun: 0.2, lamps: 1, fog: 0.08, particles: 0, particleKind: 'none', droplets: 0.25, clouds: 0.5, sway: 0.08, wet: 0.1, snow: 0, windDeg: 0, noteZh: '能见度低，雾气贴地', noteEn: 'Low visibility, ground fog' },
  { id: 'drizzle', zh: '毛毛雨', en: 'Drizzle', icon: '🌦️', tempC: 20, humidity: 80, windKmh: 9, windDir: '东南', precipitationMm: 0.8, skyTop: '#8ba0b2', skyHorizon: '#d3dbdd', sun: 0.5, lamps: 0.95, fog: 0.012, particles: 350, particleKind: 'rain', droplets: 0.35, clouds: 0.8, sway: 0.2, wet: 0.3, snow: 0, windDeg: 135, noteZh: '毛毛雨，地面微湿', noteEn: 'Light drizzle, ground damp' },
  { id: 'rain', zh: '小雨', en: 'Light rain', icon: '🌧️', tempC: 19, humidity: 85, windKmh: 14, windDir: '东南', precipitationMm: 2.4, skyTop: '#7e93a6', skyHorizon: '#ccd5d8', sun: 0.35, lamps: 1, fog: 0.016, particles: 900, particleKind: 'rain', droplets: 0.7, clouds: 0.9, sway: 0.35, wet: 0.6, snow: 0, windDeg: 135, noteZh: '小雨，屏幕有雨滴', noteEn: 'Light rain, droplets on the screen' },
  { id: 'moderate', zh: '中雨', en: 'Moderate rain', icon: '🌧️', tempC: 18, humidity: 90, windKmh: 18, windDir: '南', precipitationMm: 6.5, skyTop: '#6d7f90', skyHorizon: '#bcc6c9', sun: 0.28, lamps: 1.05, fog: 0.02, particles: 1500, particleKind: 'rain', droplets: 0.9, clouds: 0.95, sway: 0.5, wet: 0.8, snow: 0, windDeg: 180, noteZh: '中雨，天色转阴，田间泥泞', noteEn: 'Moderate rain, overcast, muddy field' },
  { id: 'storm', zh: '大雨', en: 'Heavy rain', icon: '⛈️', tempC: 17, humidity: 94, windKmh: 28, windDir: '南', precipitationMm: 12.8, skyTop: '#5d6d7c', skyHorizon: '#aeb9bd', sun: 0.2, lamps: 1.15, fog: 0.022, particles: 2200, particleKind: 'rain', droplets: 1, clouds: 1, sway: 0.7, wet: 1, snow: 0, windDeg: 180, noteZh: '大雨，不宜出车作业', noteEn: 'Heavy rain, do not send machines out' },
  { id: 'windy', zh: '大风', en: 'Windy', icon: '💨', tempC: 23, humidity: 50, windKmh: 45, windDir: '西北', precipitationMm: 0, skyTop: '#7ea8cc', skyHorizon: '#dbe7ee', sun: 0.85, lamps: 0.6, fog: 0.002, particles: 0, particleKind: 'none', droplets: 0, clouds: 0.7, sway: 1, wet: 0, snow: 0, windDeg: 315, noteZh: '大风，作物大幅摇摆，注意防风', noteEn: 'Strong wind, crops sway hard' },
  { id: 'snow', zh: '雪', en: 'Snow', icon: '❄️', tempC: -2, humidity: 78, windKmh: 9, windDir: '西北', precipitationMm: 3.1, skyTop: '#939ea6', skyHorizon: '#d3d8db', sun: 0.25, lamps: 1, fog: 0.02, particles: 1700, particleKind: 'snow', droplets: 0, clouds: 1, sway: 0.2, wet: 0.4, snow: 1, windDeg: 315, noteZh: '降雪，路面湿滑', noteEn: 'Snowfall, slippery ground' },
];

/** 南京：展厅天气的默认地点（Open-Meteo 免 key 接口，见 showroom-weather.ts）。 */
export const NANJING = { nameZh: '南京', nameEn: 'Nanjing', latitude: 32.06, longitude: 118.8 } as const;

/**
 * 轮胎旋转轴：GLB 轮胎/轮毂的几何是 XY 平面的圆盘（厚度沿 Z），车轴
 * 沿车辆横向 Z。转轮子必须绕 Z 转；旧代码绕 X 转，轮胎会像翻硬币
 * 一样翻出轮平面、轮毂被甩出中心（见 PR 说明的根因）。
 */
export const WHEEL_SPIN_AXIS = 'z' as const;

export function weatherById(id: WeatherId): WeatherPreset {
  return WEATHER_PRESETS.find((w) => w.id === id) ?? WEATHER_PRESETS[0];
}

/** 农机作业适宜度：仅供展厅面板参考的简化规则（温度 / 降水 / 风速）。 */
export type Suitability = 'good' | 'caution' | 'bad';
export function suitabilityFor(preset: WeatherPreset): Suitability {
  if (preset.precipitationMm >= 10 || preset.windKmh >= 25) return 'bad';
  if (preset.precipitationMm >= 0.5 || preset.humidity >= 85 || preset.tempC <= 0) return 'caution';
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

/**
 * Forecast bar height (px) inside the fixed-height chart strip.
 * Bars are scaled relative to the day's min/max temperature and capped
 * at FORECAST_CHART_MAX_PX, so they can never grow past the chart strip
 * and cover the weather-icon row above (the bug in the screenshot:
 * the old formula `(tempC + 5) * 3` reached 105 px inside a 74 px box
 * and overflowed upward over the icons).
 */
export const FORECAST_CHART_HEIGHT_PX = 52;
export const FORECAST_BAR_MAX_PX = 44;
export function forecastBarHeightPx(tempC: number, minTempC: number, maxTempC: number): number {
  const span = Math.max(1, maxTempC - minTempC);
  return Math.round(8 + ((tempC - minTempC) / span) * (FORECAST_BAR_MAX_PX - 8));
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
  /** Crop density multiplier (low tier thins the field to hold 30 fps). */
  crops: number;
}
export const QUALITY_TIERS: Record<QualityId, QualityTier> = {
  high: { id: 'high', zh: '高', en: 'High', pixelRatio: 2, shadows: true, post: 'full', particles: 1, crops: 1 },
  medium: { id: 'medium', zh: '中', en: 'Medium', pixelRatio: 1.5, shadows: true, post: 'bloom', particles: 0.6, crops: 0.6 },
  low: { id: 'low', zh: '低', en: 'Low', pixelRatio: 1, shadows: false, post: 'none', particles: 0.3, crops: 0.35 },
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
