/**
 * 3D 智能农机装备农田展场 — standalone route /#/showroom (fullscreen,
 * outside the app shell, following the /field-overview precedent).
 *
 * P0: hall + 4 zones + first-person walk + click fly-in + T70 + AgriDx kiosk.
 * P1: drive + auto-navigation, dynamic weather + panel, minimap + top nav.
 * P2: decor, ambient sound (WebAudio noise, off by default), opening fly-in.
 * Day/night mode is NOT done (see SHOWROOM-NOTES.md for the alternative).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './showroom.css';
import { useLang } from '@/hooks/useLang';
import ShowroomScene from './ShowroomScene';
import DiagnosisKiosk from './DiagnosisKiosk';
import { HALL, NANJING, QUALITY_TIERS, SHOWROOM_ZONES, SUITABILITY_COPY, WEATHER_PRESETS, forecast24h, forecastBarHeightPx, FORECAST_CHART_HEIGHT_PX, suitabilityFor, t70PartById, weatherById, zoneById, type QualityId, type WeatherId, type ZoneId } from './showroom-data';
import { blendWeather, nanjingForecastUrl, nextWeatherId, parseNanjingLive, WEATHER_TRANSITION_SECONDS, type NanjingLive } from './showroom-weather';
import type { BlendedWeather } from './showroom-weather';
import { planGuideRoute } from './showroom-drive';
import { createSim, type SimState } from './showroom-state';

const OVERVIEW = { pos: [0, 15, 25] as [number, number, number], look: [0, 1, 0] as [number, number, number] };

export default function ShowroomPage() {
  const lang = useLang();
  const zh = lang === 'zh';
  const [sim] = useState(() => createSim());

  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [weatherId, setWeatherId] = useState<WeatherId>('sunny');
  const [weather, setWeather] = useState<BlendedWeather>({ ...weatherById('sunny'), blend: 1 });
  const [autoCycle, setAutoCycle] = useState(false);
  // 南京实时天气（Open-Meteo 免 key）：成功时覆盖面板数值与 24 h
  // 预报；失败/超时则为 null，面板明确标注“本地预设”，不编造数值。
  const [live, setLive] = useState<NanjingLive | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [quality, setQuality] = useState<QualityId>('high');
  const [photoRequest, setPhotoRequest] = useState(0);
  const [focusZone, setFocusZone] = useState<ZoneId | null>(null);
  const [partId, setPartId] = useState<string | null>(null);
  const [kioskOpen, setKioskOpen] = useState(false);
  const [hud, setHud] = useState({ x: 0, z: 11, speedKmh: 0, mode: 'walk' });
  const [webgpu, setWebgpu] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [rapierReady, setRapierReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nearTractor, setNearTractor] = useState(false);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const weatherFromRef = useRef(weatherById('sunny'));
  const audioRef = useRef<{ ctx: AudioContext; gain: GainNode; source: AudioBufferSourceNode } | null>(null);

  // Opening fly-in (P2): start high, glide to the entrance, then walk mode.
  useEffect(() => {
    sim.mode = 'fly';
    sim.flyTo = { pos: [0, 1.7, 11], look: [0, 1.2, 0], t: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setWeatherId(id);
  }, [weatherId]);

  // 南京实时天气：页面加载时取一次 Open-Meteo（免 key，8 s 超时）。
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    void fetch(nanjingForecastUrl(), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!alive) return;
        const parsed = parseNanjingLive(payload);
        if (!parsed) return;
        setLive(parsed);
        weatherFromRef.current = weatherById(weatherId);
        setWeatherId(parsed.id);
      })
      .catch(() => {
        // Offline / timeout / malformed: stay on the local preset and
        // label it as such in the panel. Never fabricate live numbers.
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      alive = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Keyboard: arrow keys drive & walk (WASD is an alias), E enter/exit,
  // V camera view. Arrows and Space are preventDefaulted so holding them
  // never scrolls the page or activates a focused button.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
      sim.keys.add(event.code);
      if (event.code === 'KeyE' && !event.repeat) {
        if (sim.mode === 'drive') {
          sim.mode = 'walk';
          sim.autopilot = null;
          const a = sim.tractor.heading;
          sim.walk.x = sim.tractor.x + Math.cos(a) * 3;
          sim.walk.z = sim.tractor.z + Math.sin(a) * 3;
          sim.walk.yaw = a;
        } else if (sim.mode === 'walk') {
          const d = Math.hypot(sim.walk.x - sim.tractor.x, sim.walk.z - sim.tractor.z);
          if (d < 4.5) {
            sim.mode = 'drive';
            sim.flyTo = null;
            sim.focusZone = null;
            setFocusZone(null);
          }
        }
      }
      if (event.code === 'KeyV' && !event.repeat && sim.mode === 'drive') {
        sim.driveView = sim.driveView === 'follow' ? 'cabin' : 'follow';
      }
    };
    const up = (event: KeyboardEvent) => sim.keys.delete(event.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [sim]);

  // Proximity hint: show "按 E 上车" when close to the tractor.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = Math.hypot(sim.walk.x - sim.tractor.x, sim.walk.z - sim.tractor.z);
      setNearTractor(sim.mode === 'walk' && d < 4.5);
      setRapierReady(sim.rapierReady);
    }, 300);
    return () => window.clearInterval(timer);
  }, [sim]);

  const flyToZone = useCallback((id: ZoneId) => {
    const zone = zoneById(id);
    sim.mode = 'fly';
    sim.autopilot = null;
    sim.focusZone = id;
    sim.flyTo = { pos: zone.camera, look: zone.lookAt, t: 0 };
    setFocusZone(id);
    setPartId(null);
    if (id === 'agridex') setKioskOpen(true);
  }, [sim]);

  const autoDriveTo = useCallback((id: ZoneId) => {
    const zone = zoneById(id);
    sim.mode = 'drive';
    sim.flyTo = null; // Never let a half-finished fly-in shadow drive mode.
    sim.focusZone = id;
    sim.autopilot = { route: planGuideRoute(sim.tractor, id), index: 0 };
    setFocusZone(id);
    setPartId(null);
  }, [sim]);

  const backToOverview = useCallback(() => {
    sim.mode = 'fly';
    sim.autopilot = null;
    sim.focusZone = null;
    sim.flyTo = { pos: OVERVIEW.pos, look: OVERVIEW.look, t: 0 };
    setFocusZone(null);
    setPartId(null);
    setKioskOpen(false);
  }, [sim]);

  const onPosition = useCallback((x: number, z: number, speedKmh: number, mode: string) => {
    setHud({ x, z, speedKmh, mode });
  }, []);

  const onProgress = useCallback((value: number) => {
    setProgress(Math.round(value));
    if (value >= 100) setReady(true);
  }, []);

  const onZoneSelect = useCallback((id: ZoneId) => {
    flyToZone(id);
  }, [flyToZone]);

  const onAutopilotArrived = useCallback((id: ZoneId) => {
    setFocusZone(id);
  }, []);

  const onPartSelect = useCallback((id: string) => {
    setPartId(id);
    setFocusZone(null);
  }, []);

  const lockPointer = useCallback(() => {
    const canvas = canvasWrapRef.current?.querySelector('canvas');
    if (canvas && sim.mode === 'walk' && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  }, [sim]);

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
  // scene still blends toward the mapped preset for sky/light/particles).
  const displayWeather: BlendedWeather = live
    ? { ...weather, tempC: live.tempC, humidity: live.humidity, windKmh: live.windKmh, windDir: live.windDir, precipitationMm: live.precipitationMm }
    : weather;
  const suitability = suitabilityFor(displayWeather);
  const forecast = live && live.forecast.length === 8 ? live.forecast : forecast24h(weather);
  const forecastMin = Math.min(...forecast.map((f) => f.tempC));
  const forecastMax = Math.max(...forecast.map((f) => f.tempC));
  const zone = focusZone ? zoneById(focusZone) : null;
  const part = partId ? t70PartById(partId) : null;
  const mapX = ((hud.x + HALL.halfX) / (HALL.halfX * 2)) * 100;
  const mapZ = ((hud.z + HALL.halfZ) / (HALL.halfZ * 2)) * 100;

  return (
    <div className={zone || part ? 'showroom-page showroom-has-card' : 'showroom-page'}>
      <div ref={canvasWrapRef} className="showroom-canvas" onClick={lockPointer}>
        <ShowroomScene
          sim={sim}
          weather={weather}
          quality={quality}
          photoRequest={photoRequest}
          onPosition={onPosition}
          onProgress={onProgress}
          onPartSelect={onPartSelect}
          onZoneSelect={onZoneSelect}
          onAutopilotArrived={onAutopilotArrived}
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
            <button key={item.id} type="button" className={focusZone === item.id ? 'active' : ''} onClick={() => flyToZone(item.id)}>
              {zh ? item.zh : item.en}
            </button>
          ))}
        </nav>
        <div className="showroom-top-actions">
          <span className="showroom-backend" title={zh ? 'R3F 9 尚无稳定的 WebGPURenderer 绑定，本厅用 WebGL2 渲染；WebGPU 仅作能力探测（见实现笔记）。' : 'R3F 9 has no stable WebGPURenderer binding; this hall renders on WebGL2. WebGPU is probed only.'}>
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
          <span className="showroom-weather-city">{zh ? NANJING.nameZh : NANJING.nameEn}{live ? (zh ? ' · 实时' : ' · Live') : (zh ? ' · 本地预设' : ' · Preset')}</span>
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
                ? (zh ? `南京实时天气（Open-Meteo，观测 ${live.observedAt || '—'}），切换天气会覆盖为手动预设。` : `Live Nanjing weather (Open-Meteo, observed ${live.observedAt || '—'}). Switching weather overrides with a manual preset.`)
                : (zh ? '未取到南京实时天气，显示与南京季节相符的本地预设（演示数据，非实测）。' : 'Live Nanjing weather unavailable; showing a local preset for Nanjing (demo data, not measured).')}
            </p>
            <div className="showroom-weather-switch">
              {WEATHER_PRESETS.map((preset) => (
                <button key={preset.id} type="button" className={weatherId === preset.id ? 'active' : ''} onClick={() => { setLive(null); requestWeather(preset.id); }} title={zh ? preset.zh : preset.en}>
                  {preset.icon}
                </button>
              ))}
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

      {/* Rain on the screen: streaks + droplets over the canvas when it rains. */}
      {weather.particleKind === 'rain' && weather.droplets > 0 && (
        <div className="showroom-rain-overlay" aria-hidden="true" style={{ opacity: weather.droplets }}>
          <div className="showroom-rain-streaks" />
          <div className="showroom-rain-drops" />
        </div>
      )}

      {/* Minimap */}
      <aside className="showroom-minimap" aria-label={zh ? '小地图' : 'Minimap'}>
        <div className="showroom-map">
          {SHOWROOM_ZONES.map((item) => {
            const zx = ((item.dock[0] + HALL.halfX) / (HALL.halfX * 2)) * 100;
            const zy = ((item.dock[1] + HALL.halfZ) / (HALL.halfZ * 2)) * 100;
            return (
              <button
                key={item.id}
                type="button"
                className="showroom-map-zone"
                style={{ left: `${zx}%`, top: `${zy}%`, background: item.color }}
                title={zh ? item.zh : item.en}
                onClick={() => flyToZone(item.id)}
              />
            );
          })}
          <span className="showroom-map-player" style={{ left: `${mapX}%`, top: `${mapZ}%` }} />
        </div>
        <span>{hud.mode === 'drive' ? (zh ? '驾驶中' : 'Driving') : zh ? '漫游中' : 'Walking'} · {hud.speedKmh.toFixed(1)} km/h</span>
      </aside>

      {/* Drive / walk HUD */}
      <div className="showroom-drive-hud">
        {hud.mode === 'drive' && (
          <div className="showroom-speedo">
            <strong>{hud.speedKmh.toFixed(0)}</strong><span>km/h</span>
            <button type="button" onClick={() => { sim.driveView = sim.driveView === 'follow' ? 'cabin' : 'follow'; }}>
              {sim.driveView === 'follow' ? (zh ? '跟随视角' : 'Chase view') : (zh ? '驾驶舱视角' : 'Cabin view')}
            </button>
          </div>
        )}
        {nearTractor && (
          <button type="button" className="showroom-enter" onClick={() => { sim.mode = 'drive'; }}>
            {zh ? '按 E 上车驾驶' : 'Press E to drive'}
          </button>
        )}
        {hud.mode === 'drive' && (
          <button type="button" className="showroom-exit" onClick={() => { sim.mode = 'walk'; sim.autopilot = null; }}>
            {zh ? '按 E 下车' : 'Press E to exit'}
          </button>
        )}
        <div
          ref={joyRef}
          className="showroom-joystick"
          onPointerDown={(e) => { joyActive.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); updateJoystick(e.clientX, e.clientY); }}
          onPointerMove={(e) => { if (joyActive.current) updateJoystick(e.clientX, e.clientY); }}
          onPointerUp={endJoystick}
          onPointerCancel={endJoystick}
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
        <button type="button" onClick={backToOverview}>{zh ? '返回全景' : 'Overview'}</button>
      </div>

      {/* Zone card */}
      {zone && (
        <article className="showroom-card">
          <button type="button" className="showroom-icon-btn" onClick={() => setFocusZone(null)} aria-label={zh ? '关闭' : 'Close'}>✕</button>
          <span className="showroom-card-tag" style={{ background: zone.color }}>{zh ? zone.taglineZh : zone.taglineEn}</span>
          <h2>{zh ? zone.zh : zone.en}</h2>
          <p>{zh ? zone.bodyZh : zone.bodyEn}</p>
          <div className="showroom-card-actions">
            <button type="button" onClick={() => flyToZone(zone.id)}>{zh ? '飞入近景' : 'Fly in'}</button>
            {zone.id !== 'tractor' && <button type="button" onClick={() => autoDriveTo(zone.id)}>{zh ? '自动驾驶前往' : 'Auto-drive there'}</button>}
            {zone.id === 'agridex' && <button type="button" onClick={() => setKioskOpen(true)}>{zh ? '打开诊断台' : 'Open diagnosis desk'}</button>}
            <button type="button" onClick={backToOverview}>{zh ? '返回全景' : 'Overview'}</button>
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
            <li>{zh ? '点击画面锁定鼠标，方向键（↑↓←→）+ 鼠标漫游（WASD 同样可用）' : 'Click the scene to lock the mouse; arrow keys + mouse to walk (WASD also works)'}</li>
            <li>{zh ? '靠近拖拉机按 E 上车 / 下车；↑/↓ 前进后退，←/→ 转向，空格刹车，V 切换视角' : 'Near the tractor press E to enter/exit; ↑/↓ drive, ←/→ steer, Space brake, V switches view'}</li>
            <li>{zh ? '点击展区或顶部导航飞入近景；自动驾驶沿导视线行驶，可随时手动接管' : 'Click a zone or the top nav to fly in; auto-drive follows the guide line and yields to manual input'}</li>
            <li>{zh ? '触屏：左下摇杆控制移动 / 驾驶' : 'Touch: the bottom-left joystick moves and drives'}</li>
            <li>{zh ? '右上角切换天气（默认南京实时天气）；📷 4K 出一张 3840×2160 展板图' : 'Top right switches weather (Nanjing live by default); 📷 4K exports a 3840×2160 still'}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
