import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  forecast24h,
  forecastBarHeightPx,
  FORECAST_BAR_MAX_PX,
  suitabilityFor,
  weatherById,
  WEATHER_PRESETS,
  WHEEL_SPIN_AXIS,
} from '../src/pages/ShowroomPage/showroom-data';
import {
  blendWeather,
  nanjingForecastUrl,
  nextWeatherId,
  parseNanjingLive,
  weatherIdForWmo,
  windDirZh,
  WEATHER_TRANSITION_SECONDS,
} from '../src/pages/ShowroomPage/showroom-weather';

test('weather presets cover all ten conditions (sunny … windy … snow)', () => {
  assert.deepEqual(WEATHER_PRESETS.map((w) => w.id), [
    'sunny',
    'cloudy',
    'overcast',
    'fog',
    'drizzle',
    'rain',
    'moderate',
    'storm',
    'windy',
    'snow',
  ]);
});

test('suitability: storm and windy are bad, rain/moderate/drizzle/snow are caution, sunny is good', () => {
  assert.equal(suitabilityFor(weatherById('storm')), 'bad');
  assert.equal(suitabilityFor(weatherById('windy')), 'bad');
  assert.equal(suitabilityFor(weatherById('rain')), 'caution');
  assert.equal(suitabilityFor(weatherById('moderate')), 'caution');
  assert.equal(suitabilityFor(weatherById('drizzle')), 'caution');
  assert.equal(suitabilityFor(weatherById('snow')), 'caution');
  assert.equal(suitabilityFor(weatherById('sunny')), 'good');
});

test('windy sways the crops hardest, storm wets the field most, sunny neither', () => {
  assert.equal(weatherById('windy').sway, 1);
  assert.equal(weatherById('storm').wet, 1);
  assert.equal(weatherById('sunny').sway, 0.15);
  assert.equal(weatherById('sunny').wet, 0);
});

test('snow preset accumulates snow, sunny has none, blend ramps it', () => {
  assert.equal(weatherById('snow').snow, 1);
  assert.equal(weatherById('sunny').snow, 0);
  assert.equal(weatherById('rain').snow, 0);
  const mid = blendWeather(weatherById('sunny'), weatherById('snow'), 0.5);
  assert.ok(mid.snow > 0.4 && mid.snow < 0.6, `snow ${mid.snow}`);
  assert.equal(blendWeather(weatherById('snow'), weatherById('sunny'), 1).snow, 0);
});

test('wind direction lerps along the shortest arc, never the long way round', () => {
  const a = blendWeather(weatherById('windy'), weatherById('fog'), 0.5);
  // 315° → 0° halfway is 337.5°, not 157.5°.
  assert.ok(Math.abs(a.windDeg - 337.5) < 0.01, `windDeg ${a.windDeg}`);
  assert.equal(weatherById('snow').windDeg, 315);
  assert.equal(weatherById('sunny').windDeg, 135);
});

test('parseNanjingLive keeps the real wind direction in degrees', () => {
  const live = parseNanjingLive({
    current: { time: '2026-11-10T08:00', temperature_2m: 18, relative_humidity_2m: 60, precipitation: 0, weather_code: 0, wind_speed_10m: 8, wind_direction_10m: 200 },
  });
  assert.ok(live);
  assert.equal(live.windDeg, 200);
  assert.equal(live.windDir, '南西南');
});

test('blendWeather interpolates sun, fog, sway and wet, and swaps particle kind at midpoint', () => {
  const blended = blendWeather(weatherById('sunny'), weatherById('rain'), 0.5);
  assert.ok(blended.sun > 0.35 && blended.sun < 1, `sun ${blended.sun}`);
  assert.ok(blended.fog > 0 && blended.fog < 0.016);
  assert.ok(blended.sway > 0.15 && blended.sway < 0.35, `sway ${blended.sway}`);
  assert.ok(blended.wet > 0 && blended.wet < 0.6, `wet ${blended.wet}`);
  assert.equal(blended.particleKind, 'rain');
  const start = blendWeather(weatherById('sunny'), weatherById('rain'), 0);
  assert.equal(start.particleKind, 'none');
  assert.equal(start.sun, 1);
});

test('transition lasts 3–5 seconds', () => {
  assert.ok(WEATHER_TRANSITION_SECONDS >= 3 && WEATHER_TRANSITION_SECONDS <= 5);
});

test('nextWeatherId cycles through all presets and wraps', () => {
  assert.equal(nextWeatherId('snow'), 'sunny');
  assert.equal(nextWeatherId('sunny'), 'cloudy');
  assert.equal(nextWeatherId('storm'), 'windy');
});

test('forecast24h returns 8 three-hour steps with plausible values', () => {
  const forecast = forecast24h(weatherById('sunny'));
  assert.equal(forecast.length, 8);
  assert.ok(forecast.every((f) => f.tempC > 15 && f.tempC < 35));
  assert.ok(forecast.every((f) => f.precipMm === 0));
});

test('forecast bars never exceed the chart strip, so they cannot cover the icons', () => {
  // The old formula (tempC + 5) * 3 reached 105 px inside a 74 px box.
  const forecast = forecast24h(weatherById('sunny'));
  const min = Math.min(...forecast.map((f) => f.tempC));
  const max = Math.max(...forecast.map((f) => f.tempC));
  for (const f of forecast) {
    const h = forecastBarHeightPx(f.tempC, min, max);
    assert.ok(h >= 8 && h <= FORECAST_BAR_MAX_PX, `bar ${h}`);
  }
  assert.equal(forecastBarHeightPx(max, min, max), FORECAST_BAR_MAX_PX);
  assert.equal(forecastBarHeightPx(min, min, max), 8);
});

test('wheel spin axis is the axle (z): the GLB tyre disc lies in the XY plane', () => {
  assert.equal(WHEEL_SPIN_AXIS, 'z');
});

test('Nanjing forecast URL points at Open-Meteo with Nanjing coordinates, no key', () => {
  const url = nanjingForecastUrl();
  assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
  assert.ok(url.includes('latitude=32.06'));
  assert.ok(url.includes('longitude=118.8'));
  assert.ok(!/key|token|secret/i.test(url));
});

test('WMO codes map to presets, and strong wind overrides to windy', () => {
  assert.equal(weatherIdForWmo(0, 8), 'sunny');
  assert.equal(weatherIdForWmo(2, 12), 'cloudy');
  assert.equal(weatherIdForWmo(3, 10), 'overcast');
  assert.equal(weatherIdForWmo(45, 4), 'fog');
  assert.equal(weatherIdForWmo(51, 9), 'drizzle');
  assert.equal(weatherIdForWmo(61, 14), 'rain');
  assert.equal(weatherIdForWmo(63, 18), 'moderate');
  assert.equal(weatherIdForWmo(65, 28), 'storm');
  assert.equal(weatherIdForWmo(71, 9), 'snow');
  assert.equal(weatherIdForWmo(0, 45), 'windy');
  assert.equal(weatherIdForWmo(999, 5), 'cloudy');
});

test('wind direction degrees map to Chinese bearings', () => {
  assert.equal(windDirZh(0), '北');
  assert.equal(windDirZh(135), '东南');
  assert.equal(windDirZh(270), '西');
  assert.equal(windDirZh(315), '西北');
});

test('parseNanjingLive maps a real Open-Meteo payload and keeps the 24 h forecast', () => {
  // `now` carries non-zero milliseconds on purpose: the hour floor
  // must drop them too, or the 3-hour grid never matches (regression).
  const now = new Date('2026-11-10T08:00:00.456+08:00');
  // Open-Meteo hourly times are local wall-clock strings (no offset);
  // build them in the runtime's local timezone, like the parser reads them.
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmtLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
  const payload = {
    current: {
      time: '2026-11-10T08:00',
      temperature_2m: 18.5,
      relative_humidity_2m: 62,
      precipitation: 0,
      weather_code: 1,
      wind_speed_10m: 11.2,
      wind_direction_10m: 135,
    },
    hourly: {
      time: Array.from({ length: 48 }, (_, i) => fmtLocal(new Date(now.getTime() + i * 3600 * 1000))),
      temperature_2m: Array.from({ length: 48 }, (_, i) => 18 + (i % 8)),
      precipitation: Array.from({ length: 48 }, () => 0),
    },
  };
  const live = parseNanjingLive(payload, now);
  assert.ok(live);
  assert.equal(live.id, 'cloudy');
  assert.equal(live.tempC, 18.5);
  assert.equal(live.windDir, '东南');
  assert.equal(live.forecast.length, 8);
  assert.deepEqual(live.forecast.map((f) => f.hour), [0, 3, 6, 9, 12, 15, 18, 21]);
});

test('parseNanjingLive returns null on malformed payloads instead of inventing values', () => {
  assert.equal(parseNanjingLive(null), null);
  assert.equal(parseNanjingLive({}), null);
  assert.equal(parseNanjingLive({ current: { temperature_2m: 20 } }), null);
});
