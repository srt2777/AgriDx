/**
 * 3D 智能农机装备农田展场 — standalone route /#/showroom (fullscreen,
 * outside the app shell, following the /field-overview precedent).
 *
 * Tractor chase camera, field driving, weather and four interactive exhibits.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './showroom.css';
import { useLang } from '@/hooks/useLang';
import ShowroomScene from './ShowroomScene';
import DiagnosisKiosk from './DiagnosisKiosk';
import { FIELD, NANJING, QUALITY_TIERS, SHOWROOM_ZONES, SUITABILITY_COPY, WEATHER_PRESETS, forecast24h, forecastBarHeightPx, FORECAST_CHART_HEIGHT_PX, suitabilityFor, t70PartById, weatherById, zoneById, type QualityId, type WeatherId, type ZoneId } from './showroom-data';
import { blendWeather, nanjingForecastUrl, nextWeatherId, parseNanjingLive, WEATHER_TRANSITION_SECONDS, type NanjingLive } from './showroom-weather';
import type { BlendedWeather } from './showroom-weather';
import { planGuideRoute } from './showroom-drive';
import { createSim } from './showroom-state';

export default function ShowroomPage() {
  const lang = useLang();
  const zh = lang === 'zh';
  const [sim] = useState(() => createSim(new URLSearchParams(window.location.hash.split('?')[1]).get('at') === 'field'));

  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [weatherId, setWeatherId] = useState<WeatherId>('sunny');
  const [weather, setWeather] = useState<BlendedWeather>({ ...weatherById('sunny'), blend: 1 });
  const [autoCycle, setAutoCycle] = useState(false);
  // 南京实时天气（Open-Meteo 免 key）：成功时覆盖面板数值与 24 h
  // 预报；失败/超时则为 null，面板明确标注“演示”，不编造数值。
  const [live, setLive] = useState<NanjingLive | null>(null);
  const [weatherMode, setWeatherMode] = useState<'live' | 'demo'>('demo');
  // 屏幕雨滴（镜头/窗玻璃上的雨滴凝结滑落）可开关，默认开。
  const [rainDrops, setRainDrops] = useState(true);
  const engineRef = useRef<{ ctx: AudioContext; osc: OscillatorNode; gain: GainNode } | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [quality, setQuality] = useState<QualityId>('high');
  const [photoRequest, setPhotoRequest] = useState(0);
  const [focusZone, setFocusZone] = useState<ZoneId | null>(null);
  const [partId, setPartId] = useState<string | null>(null);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [hud, setHud] = useState({ x: sim.tractor.x, z: sim.tractor.z, speedKmh: 0 });
  const [webgpu, setWebgpu] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [rapierReady, setRapierReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const liveRequest = useRef<AbortController | null>(null);
  const weatherFromRef = useRef(weatherById('sunny'));
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode; source: AudioBufferSourceNode } | null>(null);

  // WebGPU capability probe (badge only — R3F 9 renders on WebGL2; see notes).
  useEffect(() => {
    let alive = true;
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } };
    if (!nav.gpu) {
      setWebgpu('unavailable');
      return;
    }
    nav.gpu
      .requestAdapter()
      .then((adapter) => alive && setWebgpu(adapter ? 'available' : 'unavailable'))
      .catch(() => alive && setWebgpu('unavailable'));
    return () => {
      alive = false;
    };
  }, []);

  // Weather transitions: blend 3–5 s toward the target preset.
  const requestWeather = useCallback((id: WeatherId) => {
    weatherFromRef.current = weatherById(weatherId);
    liveRequest.current?.abort();
    setWeatherId(id);
  }, [weatherId]);

  // 南京实时天气按需从 Open-Meteo 获取，8 秒超时。
  // 抽成回调，面板里的“使用南京实时天气”也能复用。weatherId 经 ref
  // 读取，回调本身保持稳定，不会因天气切换而重复请求。
  const weatherIdRef = useRef(weatherId);
  useEffect(() => {
    weatherIdRef.current = weatherId;
  });
  const fetchLive = useCallback(() => {
    liveRequest.current?.abort();
    const controller = new AbortController();
    liveRequest.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 8000);
    void fetch(nanjingForecastUrl(), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((payload) => {
        const parsed = parseNanjingLive(payload);
        if (!parsed || controller.signal.aborted) return;
        setLive(parsed);
        setWeatherMode('live');
        weatherFromRef.current = weatherById(weatherIdRef.current);
        setWeatherId(parsed.id);
      })
      .catch(() => {
        // Offline / timeout / malformed: stay on the local preset and
        // label it as demo in the panel. Never fabricate live numbers.
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (liveRequest.current === controller) liveRequest.current = null;
      });
  }, []);

  useEffect(() => () => liveRequest.current?.abort(), []);

  // Shareable weather preset, e.g. /#/showroom?weather=rain.
  useEffect(() => {
    const query = window.location.hash.split('?')[1];
    if (!query) return;
    const params = new URLSearchParams(query);
    const w = params.get('weather');
    if (w && WEATHER_PRESETS.some((p) => p.id === w)) {
      setLive(null);
      setWeatherMode('demo');
      weatherFromRef.current = weatherById(weatherIdRef.current);
      setWeatherId(w as WeatherId);
    }
  }, []);

  useEffect(() => {
    const from = weatherFromRef.current;
    const to = weatherById(weatherId);
    if (from.id === to.id) {
      setWeather({ ...to, blend: 1 });
      return;
    }
    const start = performance.now();
    let raf = 0;
    let lastSet = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (WEATHER_TRANSITION_SECONDS * 1000));
      if (now - lastSet > 66 || t >= 1) {
        lastSet = now;
        setWeather(blendWeather(from, to, t));
      }
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [weatherId]);

  // Auto weather cycle.
  useEffect(() => {
    if (!autoCycle) return;
    const timer = window.setInterval(() => {
      setWeatherId((current) => nextWeatherId(current));
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoCycle]);

  // Ambient sound: WebAudio filtered noise (rain/wind), off by default.
  useEffect(() => {
    if (!soundOn) {
      audioRef.current?.ctx.close().catch(() => undefined);
      audioRef.current = null;
      return;
    }
    const ctx = new AudioContext();
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = weather.particleKind === 'rain' ? 2400 : 700;
    const gain = ctx.createGain();
    gain.gain.value = weather.precipitationMm > 0 ? 0.05 : 0.02;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    audioRef.current = { ctx, gain, source };
    return () => {
      source.stop();
      void ctx.close();
      audioRef.current = null;
    };
  }, [soundOn, weather.particleKind, weather.precipitationMm]);

  // Engine sound: a low sawtooth whose pitch follows tractor speed
  // (55 Hz idle → ~145 Hz at field top speed), only while the ambient
  // sound toggle is on; gain stays low and it silences when parked.
  useEffect(() => {
    if (!soundOn) {
      engineRef.current = null;
      return;
    }
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    engineRef.current = { ctx, osc, gain };
    const timer = window.setInterval(() => {
      const speed = Math.abs(sim.tractor.speed);
      const boosting = sim.keys.has('ShiftLeft') || sim.keys.has('ShiftRight');
      gain.gain.setTargetAtTime(0.012 + Math.min(0.02, speed * 0.0025), ctx.currentTime, 0.15);
      osc.frequency.setTargetAtTime(55 + speed * 13 + (boosting ? 18 : 0), ctx.currentTime, 0.15);
    }, 150);
    return () => {
      window.clearInterval(timer);
      osc.stop();
      void ctx.close().catch(() => undefined);
      engineRef.current = null;
    };
  }, [soundOn, sim]);

  useEffect(() => {
    const driveKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);
    const down = (event: KeyboardEvent) => {
      if (!driveKeys.has(event.code) || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable ||
        target.closest('input, textarea, select, [role="dialog"]'))) return;
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
      sim.keys.add(event.code);
    };
    const up = (event: KeyboardEvent) => sim.keys.delete(event.code);
    const clearKeys = () => sim.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
    };
  }, [sim]);

  useEffect(() => {
    const timer = window.setInterval(() => setRapierReady(sim.rapierReady), 300);
    return () => window.clearInterval(timer);
  }, [sim]);

  const onZoneSelect = useCallback((id: ZoneId) => {
    setFocusZone(id);
    setPartId(null);
    if (id === 'agridex') setKioskOpen(true);
  }, []);

  const autoDriveTo = useCallback((id: ZoneId) => {
    sim.autopilot = { zone: id, route: planGuideRoute(sim.tractor, id), index: 0 };
  }, [sim]);

  const onPosition = useCallback((x: number, z: number, speedKmh: number) => {
    setHud({ x, z, speedKmh });
  }, []);

  const onProgress = useCallback((value: number) => {
    setProgress(Math.round(value));
    if (value >= 100) setReady(true);
  }, []);

  const onPartSelect = useCallback((id: string) => {
    setPartId(id);
    setFocusZone(null);
  }, []);

  // Touch joystick.
  const joyRef = useRef<HTMLDivElement>(null);
  const joyActive = useRef(false);
  const updateJoystick = useCallback((clientX: number, clientY: number) => {
    const el = joyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(-1, Math.min(1, (clientX - cx) / (rect.width / 2)));
    const dy = Math.max(-1, Math.min(1, (clientY - cy) / (rect.height / 2)));
    sim.joystick = { x: dx, y: dy };
    const knob = el.querySelector<HTMLElement>('.showroom-joy-knob');
    if (knob) knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
  }, [sim]);
  const endJoystick = useCallback(() => {
    joyActive.current = false;
    sim.joystick = { x: 0, y: 0 };
    const knob = joyRef.current?.querySelector<HTMLElement>('.showroom-joy-knob');
    if (knob) knob.style.transform = 'translate(0, 0)';
  }, [sim]);

  // Live Nanjing values override the preset's panel numbers (the 3D
  // scene still blends toward the mapped preset for sky/light/particles),
  // including the real wind direction for the shader wind field.
  const displayWeather: BlendedWeather = live
    ? { ...weather, tempC: live.tempC, humidity: live.humidity, windKmh: live.windKmh, windDir: live.windDir, precipitationMm: live.precipitationMm }
    : weather;
  const sceneWeather: BlendedWeather = live ? { ...weather, windDeg: live.windDeg } : weather;
  const suitability = suitabilityFor(displayWeather);
  const forecast = live && live.forecast.length === 8 ? live.forecast : forecast24h(weather);
  const forecastMin = Math.min(...forecast.map((f) => f.tempC));
  const forecastMax = Math.max(...forecast.map((f) => f.tempC));
  const zone = focusZone ? zoneById(focusZone) : null;
  const part = partId ? t70PartById(partId) : null;
  const mapX = ((hud.x + FIELD.halfX) / (FIELD.halfX * 2)) * 100;
  const mapZ = ((hud.z + FIELD.halfZ) / (FIELD.halfZ * 2)) * 100;

  return (
    <div className={zone || part ? 'showroom-page showroom-has-card' : 'showroom-page'}>
      <div className="showroom-canvas">
        <ShowroomScene
          sim={sim}
          weather={sceneWeather}
          quality={quality}
          photoRequest={photoRequest}
          onPosition={onPosition}
          onProgress={onProgress}
          onPartSelect={onPartSelect}
          onZoneSelect={onZoneSelect}
          onAutopilotArrived={setFocusZone}
        />
      </div>

      {!ready && (
        <div className="showroom-loader" role="status">
          <div className="showroom-loader-inner">
            <strong>{zh ? '智能农机装备农田展场' : 'Smart Agri-Machinery Farm Showroom'}</strong>
            <span>{zh ? '正在加载农田展场与鸿鹄 T70 模型…' : 'Loading the farm field and the Honghu T70…'}</span>
            <div className="showroom-progress"><i style={{ width: `${progress}%` }} /></div>
            <span>{progress}%</span>
          </div>
        </div>
      )}

      {/* Top navigation */}
      <header className="showroom-topbar">
        <Link className="showroom-back" to="/">{zh ? '‹ 大厅' : '‹ Hub'}</Link>
        <strong className="showroom-title">{zh ? '智能农机装备农田展场' : 'Smart Agri-Machinery Farm Showroom'}</strong>
        <nav className="showroom-zonenav" aria-label={zh ? '展区' : 'Zones'}>
          {SHOWROOM_ZONES.map((item) => (
            <button key={item.id} type="button" className={focusZone === item.id ? 'active' : ''} onClick={() => onZoneSelect(item.id)}>
              {zh ? item.zh : item.en}
            </button>
          ))}
        </nav>
        <div className="showroom-top-actions">
          <span className="showroom-backend" title={zh ? 'R3F 9 尚无稳定的 WebGPURenderer 绑定，本场景用 WebGL2 渲染；WebGPU 仅作能力探测（见实现笔记）。' : 'R3F 9 has no stable WebGPURenderer binding; this scene renders on WebGL2. WebGPU is probed only.'}>
            {webgpu === 'available' ? 'WebGPU ✓' : webgpu === 'unavailable' ? 'WebGL2' : '…'}
          </span>
          <span className="showroom-physics" title={zh ? '驾驶物理：Rapier 射线车辆控制器（每轮射线 + 刚体碰撞）；初始化失败时退回运动学模型。' : 'Drive physics: Rapier raycast vehicle; kinematic fallback if init fails.'}>
            {rapierReady ? 'Rapier ✓' : 'Rapier…'}
          </span>
          <button type="button" onClick={() => setSoundOn((v) => !v)} aria-pressed={soundOn} title={zh ? '环境音（雨声/风声），默认关闭' : 'Ambient sound, off by default'}>
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button type="button" onClick={() => setHelpOpen((v) => !v)} aria-label={zh ? '操作说明' : 'Help'}>?</button>
        </div>
      </header>

      {/* Weather panel — Nanjing (Open-Meteo live, local preset fallback) */}
      <section className="showroom-weather" aria-label={zh ? '天气与监测' : 'Weather'}>
        <button type="button" className="showroom-weather-summary" onClick={() => setWeatherOpen((v) => !v)}>
          <span className="showroom-weather-icon">{displayWeather.icon}</span>
          <span><strong>{displayWeather.tempC.toFixed(0)}°C</strong> {zh ? displayWeather.zh : displayWeather.en}</span>
          <span className="showroom-weather-city">{zh ? NANJING.nameZh : NANJING.nameEn}{weatherMode === 'live' ? (zh ? ' · 实时' : ' · Live') : (zh ? ' · 演示' : ' · Demo')}</span>
          <span className={`showroom-suit suit-${suitability}`}>{zh ? SUITABILITY_COPY[suitability].zh : SUITABILITY_COPY[suitability].en}</span>
        </button>
        {weatherOpen && (
          <div className="showroom-weather-detail">
            <div className="showroom-weather-grid">
              <span>{zh ? '湿度' : 'Humidity'} {displayWeather.humidity.toFixed(0)}%</span>
              <span>{zh ? '风速' : 'Wind'} {displayWeather.windKmh.toFixed(0)} km/h {displayWeather.windDir}</span>
              <span>{zh ? '降水' : 'Precip'} {displayWeather.precipitationMm.toFixed(1)} mm</span>
              <span>{zh ? '作业适宜度' : 'Suitability'} {zh ? SUITABILITY_COPY[suitability].zh : SUITABILITY_COPY[suitability].en}</span>
            </div>
            <p className="showroom-weather-note">{zh ? displayWeather.noteZh : displayWeather.noteEn}</p>
            <p className="showroom-weather-source">
              {live
                ? (zh ? `南京实时天气（Open-Meteo，观测 ${live.observedAt || '—'}），切换天气会覆盖为手动预设（演示模式）。` : `Live Nanjing weather (Open-Meteo, observed ${live.observedAt || '—'}). Switching weather overrides with a manual preset (demo mode).`)
                : (zh ? '演示模式：当前使用本地天气预设。' : 'Demo mode: using a local weather preset.')}
            </p>
            <div className="showroom-weather-switch">
              {WEATHER_PRESETS.map((preset) => (
                <button key={preset.id} type="button" className={weatherId === preset.id ? 'active' : ''} onClick={() => { setLive(null); setWeatherMode('demo'); requestWeather(preset.id); }} title={zh ? preset.zh : preset.en}>
                  {preset.icon}
                </button>
              ))}
            </div>
            <div className="showroom-weather-actions">
              <button type="button" onClick={() => fetchLive()}>{zh ? '使用南京实时天气' : 'Use live Nanjing weather'}</button>
              {weather.particleKind === 'rain' && (
                <label className="showroom-cycle">
                  <input type="checkbox" checked={rainDrops} onChange={(e) => setRainDrops(e.target.checked)} />
                  {zh ? '屏幕雨滴' : 'Screen droplets'}
                </label>
              )}
            </div>
            <label className="showroom-cycle">
              <input type="checkbox" checked={autoCycle} onChange={(e) => setAutoCycle(e.target.checked)} />
              {zh ? '自动循环（每 30 秒）' : 'Auto-cycle (30 s)'}
            </label>
            <div className="showroom-forecast">
              {forecast.map((f) => (
                <div key={f.hour} className="showroom-forecast-bar">
                  <div className="showroom-forecast-chart" style={{ height: `${FORECAST_CHART_HEIGHT_PX}px` }}>
                    <i style={{ height: `${forecastBarHeightPx(f.tempC, forecastMin, forecastMax)}px` }} />
                  </div>
                  <span>+{f.hour}h</span>
                  <span>{f.tempC.toFixed(0)}°</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Rain on the screen: streaks + droplets over the canvas when it rains (toggleable). */}
      {weather.particleKind === 'rain' && weather.droplets > 0 && rainDrops && (
        <div className="showroom-rain-overlay" aria-hidden="true" style={{ opacity: weather.droplets }}>
          <div className="showroom-rain-streaks" />
          <div className="showroom-rain-drops" />
        </div>
      )}

      {/* Minimap */}
      <aside className="showroom-minimap" aria-label={zh ? '小地图' : 'Minimap'}>
        <div className="showroom-map">
          {SHOWROOM_ZONES.map((item) => {
            const zx = ((item.dock[0] + FIELD.halfX) / (FIELD.halfX * 2)) * 100;
            const zy = ((item.dock[1] + FIELD.halfZ) / (FIELD.halfZ * 2)) * 100;
            return (
              <button
                key={item.id}
                type="button"
                className="showroom-map-zone"
                style={{ left: `${zx}%`, top: `${zy}%`, background: item.color }}
                title={zh ? item.zh : item.en}
                onClick={() => onZoneSelect(item.id)}
              />
            );
          })}
          <span className="showroom-map-player" style={{ left: `${mapX}%`, top: `${mapZ}%` }} />
        </div>
        <span>{zh ? '驾驶中' : 'Driving'} · {hud.speedKmh.toFixed(1)} km/h</span>
      </aside>

      <div className="showroom-drive-hud">
        <div className="showroom-speedo">
          <strong>{hud.speedKmh.toFixed(0)}</strong><span>km/h</span>
        </div>
        <div
          ref={joyRef}
          className="showroom-joystick"
          onPointerDown={(e) => { joyActive.current = true; e.currentTarget.setPointerCapture(e.pointerId); updateJoystick(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (joyActive.current) updateJoystick(e.clientX, e.clientY); }}
          onPointerUp={endJoystick}
          onPointerCancel={endJoystick}
          onLostPointerCapture={endJoystick}
        >
          <span className="showroom-joy-knob" />
        </div>
      </div>

      {/* Quality + photo */}
      <div className="showroom-quality">
        {(Object.keys(QUALITY_TIERS) as QualityId[]).map((id) => (
          <button key={id} type="button" className={quality === id ? 'active' : ''} onClick={() => setQuality(id)}>
            {zh ? QUALITY_TIERS[id].zh : QUALITY_TIERS[id].en}
          </button>
        ))}
        <button type="button" onClick={() => setPhotoRequest((n) => n + 1)} title={zh ? '高质量出图：3840×2160 PNG（离屏高分辨率渲染）' : 'Photo mode: 3840×2160 PNG'}>
          📷 4K
        </button>
      </div>

      {/* Zone card */}
      {zone && (
        <article className="showroom-card">
          <button type="button" className="showroom-icon-btn" onClick={() => setFocusZone(null)} aria-label={zh ? '关闭' : 'Close'}>✕</button>
          <span className="showroom-card-tag" style={{ background: zone.color }}>{zh ? zone.taglineZh : zone.taglineEn}</span>
          <h2>{zh ? zone.zh : zone.en}</h2>
          <p>{zh ? zone.bodyZh : zone.bodyEn}</p>
          <div className="showroom-card-actions">
            {zone.id !== 'tractor' && <button type="button" onClick={() => autoDriveTo(zone.id)}>{zh ? '自动驾驶前往' : 'Auto-drive there'}</button>}
            {zone.id === 'agridex' && <button type="button" onClick={() => setKioskOpen(true)}>{zh ? '打开诊断台' : 'Open diagnosis desk'}</button>}
          </div>
        </article>
      )}

      {/* T70 part card */}
      {part && (
        <article className="showroom-card showroom-part-card">
          <button type="button" className="showroom-icon-btn" onClick={() => setPartId(null)} aria-label={zh ? '关闭' : 'Close'}>✕</button>
          <span className="showroom-card-tag" style={{ background: '#2e7d46' }}>{zh ? '鸿鹄 T70 · 部件' : 'Honghu T70 · Part'}</span>
          <h2>{zh ? part.zh : part.en}</h2>
          <p>{zh ? part.detailZh : part.detailEn}</p>
        </article>
      )}

      {kioskOpen && <DiagnosisKiosk lang={lang} onClose={() => setKioskOpen(false)} />}

      {helpOpen && (
        <div className="showroom-help" role="dialog" aria-label={zh ? '操作说明' : 'Controls'}>
          <button type="button" className="showroom-icon-btn" onClick={() => setHelpOpen(false)} aria-label={zh ? '关闭' : 'Close'}>✕</button>
          <h2>{zh ? '操作说明' : 'Controls'}</h2>
          <ul>
            <li>{zh ? '↑/↓ 或 W/S 前进后退，←/→ 或 A/D 转向，空格刹车；触屏使用左下摇杆' : '↑/↓ or W/S to drive, ←/→ or A/D to steer, Space to brake. Use the joystick on touchscreens.'}</li>
            <li>{zh ? '点击展区查看介绍，可选择自动驾驶前往，方向键或摇杆可接管' : 'Select a zone for details. Start auto-drive from its card and take over with the keys or joystick.'}</li>
            <li>{zh ? '露天农田展场：沿土路驾驶，Shift 加速（最高约 8.8 m/s），雨雪天路面较滑' : 'Open-air farm field: drive along the dirt track, Shift to boost (top ≈ 8.8 m/s), slippery when wet or snowy'}</li>
            <li>{zh ? '右上角切换天气（实时模式取南京 Open-Meteo，断网自动回演示模式并标明；雨天可开关屏幕雨滴）；📷 4K 出一张 3840×2160 展板图' : 'Top right switches weather (live Nanjing via Open-Meteo; offline it falls back to demo mode and says so; screen droplets toggle in rain); 📷 4K exports a 3840×2160 still'}</li>
            <li>{zh ? '农田分块种水稻/小麦/玉米（不同生长阶段），低画质自动减少作物密度保流畅；链接加 ?weather=rain 可直接进指定天气驾驶' : 'The field grows rice, wheat and corn in plots at different stages; low quality thins the crops to hold frame rate; add ?weather=rain to a link to start driving in that weather'}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
