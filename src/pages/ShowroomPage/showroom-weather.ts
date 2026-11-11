/**
 * Weather blending: smooth 3–5 s transitions between presets.
 * Colours are lerped in RGB; scalars linearly. Pure functions, tested.
 */
import { WEATHER_PRESETS, weatherById, type WeatherId, type WeatherPreset } from './showroom-data';

export const WEATHER_TRANSITION_SECONDS = 4;

function hexRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [
    Number.parseInt(v.slice(0, 2), 16),
    Number.parseInt(v.slice(2, 4), 16),
    Number.parseInt(v.slice(4, 6), 16),
  ];
}

function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[mix(ar, br), mix(ag, bg), mix(ab, bb)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface BlendedWeather extends WeatherPreset {
  /** 0..1 progress of the transition toward `id`. */
  blend: number;
}

/** Blend `from` toward `to` by t (0 = from, 1 = to). */
export function blendWeather(from: WeatherPreset, to: WeatherPreset, t: number): BlendedWeather {
  const c = Math.min(1, Math.max(0, t));
  return {
    ...to,
    blend: c,
    tempC: lerp(from.tempC, to.tempC, c),
    humidity: lerp(from.humidity, to.humidity, c),
    windKmh: lerp(from.windKmh, to.windKmh, c),
    precipitationMm: lerp(from.precipitationMm, to.precipitationMm, c),
    skyTop: mixHex(from.skyTop, to.skyTop, c),
    skyHorizon: mixHex(from.skyHorizon, to.skyHorizon, c),
    sun: lerp(from.sun, to.sun, c),
    lamps: lerp(from.lamps, to.lamps, c),
    fog: lerp(from.fog, to.fog, c),
    particles: Math.round(lerp(from.particles, to.particles, c)),
    particleKind: c < 0.5 ? from.particleKind : to.particleKind,
    droplets: lerp(from.droplets, to.droplets, c),
    clouds: lerp(from.clouds, to.clouds, c),
    sway: lerp(from.sway, to.sway, c),
    wet: lerp(from.wet, to.wet, c),
    snow: lerp(from.snow, to.snow, c),
    // Wind direction lerps along the shortest arc so the shader wind
    // never spins the long way round during a transition.
    windDeg: (((from.windDeg + ((((to.windDeg - from.windDeg + 540) % 360) - 180) * c)) % 360) + 360) % 360,
  };
}

/** Next weather in the auto-cycle order (skips nothing). */
export function nextWeatherId(current: WeatherId): WeatherId {
  const ids = WEATHER_PRESETS.map((w) => w.id);
  return ids[(ids.indexOf(current) + 1) % ids.length];
}

export { weatherById };

/* ------------------------------------------------------------------ */
/* 南京实时天气（Open-Meteo，免 key、无需注册）                        */
/* ------------------------------------------------------------------ */

import { NANJING } from './showroom-data';

/** Open-Meteo 南京预报接口（current + 未来 48 h，每 3 h 取 8 步）。 */
export function nanjingForecastUrl(): string {
  const params = new URLSearchParams({
    latitude: String(NANJING.latitude),
    longitude: String(NANJING.longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,precipitation',
    timezone: 'Asia/Shanghai',
    forecast_days: '2',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

/** WMO 天气代码 → 展厅天气预设。风速 ≥40 km/h 时一律判为大风。 */
export function weatherIdForWmo(code: number, windKmh: number): WeatherId {
  if (windKmh >= 40) return 'windy';
  if (code === 0) return 'sunny';
  if (code === 1 || code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code === 51 || code === 53 || code === 55 || code === 56 || code === 57) return 'drizzle';
  if (code === 61 || code === 80) return 'rain';
  if (code === 63 || code === 81 || code === 66 || code === 67) return 'moderate';
  if (code === 65 || code === 82 || code === 95 || code === 96 || code === 99) return 'storm';
  if (code === 71 || code === 73 || code === 75 || code === 77 || code === 85 || code === 86) return 'snow';
  return 'cloudy';
}

/** 风向度数 → 中文方位（16 方位）。 */
export function windDirZh(degrees: number): string {
  const dirs = ['北', '北东北', '东北', '东东北', '东', '东东南', '东南', '南东南', '南', '南西南', '西南', '西西南', '西', '西北西', '西北', '北西北'];
  const idx = Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

export interface NanjingLive {
  /** Mapped preset id for the scene. */
  id: WeatherId;
  tempC: number;
  humidity: number;
  windKmh: number;
  windDir: string;
  /** Wind direction in degrees (0 = from the north, clockwise). */
  windDeg: number;
  precipitationMm: number;
  /** Live 24 h forecast: 8 steps, 3 h apart, from the current hour. */
  forecast: { hour: number; tempC: number; precipMm: number }[];
  /** ISO time string returned by Open-Meteo for `current`. */
  observedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Parse an Open-Meteo forecast response into Nanjing live weather.
 * Returns null on any malformed/missing field — the caller then falls
 * back to the Nanjing-season local preset and labels it as preset data.
 * Never invents values: no live number is produced without the API.
 */
export function parseNanjingLive(payload: unknown, now = new Date()): NanjingLive | null {
  if (!isRecord(payload)) return null;
  const current = isRecord(payload.current) ? payload.current : null;
  if (!current) return null;
  const tempC = num(current.temperature_2m);
  const humidity = num(current.relative_humidity_2m);
  const precipitationMm = num(current.precipitation);
  const code = num(current.weather_code);
  const windKmh = num(current.wind_speed_10m);
  const windDeg = num(current.wind_direction_10m);
  if (tempC === null || humidity === null || precipitationMm === null || code === null || windKmh === null || windDeg === null) return null;
  const id = weatherIdForWmo(code, windKmh);

  const forecast: NanjingLive['forecast'] = [];
  const hourly = isRecord(payload.hourly) ? payload.hourly : null;
  if (hourly && Array.isArray(hourly.time) && Array.isArray(hourly.temperature_2m) && Array.isArray(hourly.precipitation)) {
    // Floor `now` to the start of its hour (minutes + seconds +
    // milliseconds, otherwise the 3-hour modulo below never matches
    // and the live forecast silently falls back to the preset curve).
    const startHour = now.getTime() - ((now.getMinutes() * 60 + now.getSeconds()) * 1000 + now.getMilliseconds());
    let taken = 0;
    for (let i = 0; i < hourly.time.length && taken < 8; i++) {
      const t = Date.parse(String(hourly.time[i]));
      if (!Number.isFinite(t) || t < startHour) continue;
      if ((t - startHour) % (3 * 3600 * 1000) !== 0) continue;
      const ft = num(hourly.temperature_2m[i]);
      const fp = num(hourly.precipitation[i]);
      if (ft === null || fp === null) continue;
      forecast.push({ hour: Math.round((t - startHour) / 3600000), tempC: Math.round(ft * 10) / 10, precipMm: Math.max(0, Math.round(fp * 10) / 10) });
      taken += 1;
    }
  }
  return {
    id,
    tempC: Math.round(tempC * 10) / 10,
    humidity: Math.round(humidity),
    windKmh: Math.round(windKmh * 10) / 10,
    windDir: windDirZh(windDeg),
    windDeg: Math.round(windDeg),
    precipitationMm: Math.round(precipitationMm * 10) / 10,
    forecast,
    observedAt: typeof current.time === 'string' ? current.time : '',
  };
}
