import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forecast24h, suitabilityFor, weatherById, WEATHER_PRESETS } from '../src/pages/ShowroomPage/showroom-data';
import { blendWeather, nextWeatherId, WEATHER_TRANSITION_SECONDS } from '../src/pages/ShowroomPage/showroom-weather';

test('weather presets cover all seven required conditions', () => {
  assert.deepEqual(WEATHER_PRESETS.map((w) => w.id), ['sunny', 'cloudy', 'overcast', 'fog', 'rain', 'storm', 'snow']);
});

test('suitability: storm is bad, rain is caution, sunny is good', () => {
  assert.equal(suitabilityFor(weatherById('storm')), 'bad');
  assert.equal(suitabilityFor(weatherById('rain')), 'caution');
  assert.equal(suitabilityFor(weatherById('sunny')), 'good');
  assert.equal(suitabilityFor(weatherById('snow')), 'caution');
});

test('blendWeather interpolates sun and fog, and swaps particle kind at midpoint', () => {
  const blended = blendWeather(weatherById('sunny'), weatherById('rain'), 0.5);
  assert.ok(blended.sun > 0.35 && blended.sun < 1, `sun ${blended.sun}`);
  assert.ok(blended.fog > 0 && blended.fog < 0.016);
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
});

test('forecast24h returns 8 three-hour steps with plausible values', () => {
  const forecast = forecast24h(weatherById('sunny'));
  assert.equal(forecast.length, 8);
  assert.ok(forecast.every((f) => f.tempC > 15 && f.tempC < 35));
  assert.ok(forecast.every((f) => f.precipMm === 0));
});
