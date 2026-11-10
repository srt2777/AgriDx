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
  };
}

/** Next weather in the auto-cycle order (skips nothing). */
export function nextWeatherId(current: WeatherId): WeatherId {
  const ids = WEATHER_PRESETS.map((w) => w.id);
  return ids[(ids.indexOf(current) + 1) % ids.length];
}

export { weatherById };
