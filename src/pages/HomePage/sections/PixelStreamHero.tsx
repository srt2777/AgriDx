import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Maximize, Pause, Play, PlugZap, Power, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLang } from '@/hooks/useLang';
import { publicAsset } from '@/lib/public-asset';
import { preloadPage } from '@/lib/page-loaders';
import { catalogByName, catalogParts, partTitle } from '@/components/parts-tractor/parts-catalog';
import {
  resolveSignallingUrl,
  streamStatusText,
  urlProblemText,
  type StreamStatus,
} from './pixel-streaming';
import './pixel-stream-hero.css';

const T70FallbackScene = lazy(() => import('./T70FallbackScene'));

type StreamHandle = {
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  addEventListener: (type: string, listener: () => void) => void;
};

/**
 * Classic-home Pixel Streaming hero, step one.
 *
 * The stream itself is NOT wired up in this PR: there is no Unreal project
 * and no streaming server in the repo, and VITE_PIXEL_STREAMING_URL is empty
 * by default. Until a Cirrus signalling address is configured and a
 * streamer is online, this section shows the "not configured" state and
 * falls back to the web T70 model below. Nothing here pretends the
 * stream is live: the video element is only ever created by Epic's
 * official frontend library (see handleConnect), never by a hand-rolled
 * WebRTC player.
 *
 * Mouse / keyboard / touch input reaches the stream through the official
 * library: it attaches its input controllers to the video parent element
 * once a stream starts, gated by the MouseInput / KeyboardInput /
 * TouchInput flags set below.
 */
export default function PixelStreamHero() {
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const configured = resolveSignallingUrl(import.meta.env.VITE_PIXEL_STREAMING_URL as string | undefined);
  const [status, setStatus] = useState<StreamStatus>(configured.url ? 'disconnected' : 'unconfigured');
  const [urlProblem, setUrlProblem] = useState<string | null>(
    configured.problem ? urlProblemText(configured.problem, lang) : null,
  );
  const [fallbackParts, setFallbackParts] = useState<{ name: string; labelZh: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [modelReady, setModelReady] = useState(false);
  const [modelFailed, setModelFailed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const streamHostRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<StreamHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  const userDisconnectRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      clearTimer();
      try {
        streamRef.current?.disconnect();
      } catch {
        // Disconnect during unmount must never throw into React.
      }
      streamRef.current = null;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (!configured.url) {
      setStatus(configured.problem ? 'failed' : 'unconfigured');
      setUrlProblem(configured.problem ? urlProblemText(configured.problem, lang) : null);
      return;
    }
    setUrlProblem(null);
    setStatus('connecting');
    userDisconnectRef.current = false;
    clearTimer();
    try {
      const host = streamHostRef.current;
      if (!host) throw new Error('Stream host is not mounted');
      const mod = await import('@epicgames-ps/lib-pixelstreamingfrontend-ue5.6');
      const config = new mod.Config({
        initialSettings: {
          ss: configured.url,
          AutoPlayVideo: true,
          MouseInput: true,
          KeyboardInput: true,
          TouchInput: true,
        },
      });
      const stream = new mod.PixelStreaming(config, { videoElementParent: host }) as unknown as StreamHandle;
      streamRef.current = stream;
      stream.addEventListener('webRtcConnecting', () => setStatus('connecting'));
      stream.addEventListener('webRtcConnected', () => {
        clearTimer();
        setStatus('connected');
      });
      stream.addEventListener('playStream', () => {
        clearTimer();
        setStatus('connected');
      });
      const onDrop = () => {
        clearTimer();
        setStatus(userDisconnectRef.current ? 'disconnected' : 'failed');
      };
      stream.addEventListener('webRtcFailed', onDrop);
      stream.addEventListener('webRtcDisconnected', onDrop);
      stream.addEventListener('streamDisconnect', onDrop);
      stream.connect();
      // Safety net: never spin forever if the signalling server never
      // answers. A real Cirrus failure normally fires webRtcFailed first.
      timerRef.current = window.setTimeout(() => {
        if (streamRef.current === stream) {
          try {
            stream.disconnect();
          } catch {
            // Ignore: the state below is what the user sees.
          }
          setStatus('failed');
        }
      }, 20000);
    } catch {
      clearTimer();
      setStatus('failed');
    }
  }, [configured.url, configured.problem, lang]);

  const handleDisconnect = useCallback(() => {
    clearTimer();
    userDisconnectRef.current = true;
    try {
      streamRef.current?.disconnect();
    } catch {
      // Ignore: the status below is authoritative.
    }
    setStatus('disconnected');
  }, []);

  const handleReconnect = useCallback(() => {
    handleDisconnect();
    void handleConnect();
  }, [handleConnect, handleDisconnect]);

  const toggleFullscreen = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void panel.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const selectPart = useCallback((name: string | null) => {
    setSelected(name);
    if (name) setAutoOrbit(false);
  }, []);

  const selectedPart = fallbackParts.find(part => part.name === selected) ?? null;
  const partLabel = (name: string, labelZh: string) => {
    const node = catalogByName(name, 't70')?.node;
    return node ? partTitle(node, lang, 't70') : labelZh;
  };
  const selectedTitle = selectedPart ? partLabel(selectedPart.name, selectedPart.labelZh) : '';
  const catalogOrder = catalogParts('t70').map(part => part.name);
  const orderedParts = [...fallbackParts].sort((a, b) => catalogOrder.indexOf(a.name) - catalogOrder.indexOf(b.name));
  const showFallback = status !== 'connected';

  return (
    <section className="pixel-stream-hero page-container" aria-label={t('虚幻像素流与鸿鹄 T70 模型', 'Unreal Pixel Streaming and Honghu T70 model')}>
      <div className="pixel-stream-panel" ref={panelRef}>
        <div className="pixel-stream-head">
          <div>
            <p className="pixel-stream-kicker">{t('虚幻引擎 · 像素流', 'Unreal Engine · Pixel Streaming')}</p>
            <h2 className="pixel-stream-title">{t('鸿鹄 T70 实时画面', 'Honghu T70 live view')}</h2>
          </div>
          <span className={`pixel-stream-status pixel-stream-status--${status}`} role="status">
            {streamStatusText(status, lang)}
          </span>
        </div>

        <div className="pixel-stream-stage" ref={streamHostRef}>
          {status !== 'connected' && (
            <div className="pixel-stream-empty">
              {status === 'unconfigured' && (
                <>
                  <strong>{t('像素流未接入', 'Pixel stream not configured')}</strong>
                  <p>{t('本 PR 只含网页播放器与虚幻工程方案，流本身未接通、没有服务器。配置信令地址并上线虚幻流之后，这里才会出现实时画面；现在请看下面的网页版 T70 模型。', 'This step ships only the web player and the Unreal project plan; no stream or server exists yet. Once a signalling address is configured and an Unreal streamer is online, the live picture appears here. For now, see the web T70 model below.')}</p>
                  <p className="pixel-stream-hint">{t('配置项：VITE_PIXEL_STREAMING_URL（构建期环境变量，默认空；只填 ws:// 或 wss:// 信令地址，绝不填密钥或 token）。', 'Setting: VITE_PIXEL_STREAMING_URL (build-time env var, empty by default; ws:// or wss:// signalling address only, never a secret or token).')}</p>
                </>
              )}
              {status === 'connecting' && <p>{t('正在连接信令服务器…若 20 秒内无响应，将自动判为连接失败并回落到下面的模型。', 'Connecting to the signalling server… if there is no response within 20 seconds this is treated as a failed connection and the model below is shown.')}</p>}
              {status === 'failed' && (
                <>
                  <strong>{t('连接失败，已回落到网页版 T70 模型', 'Connection failed; showing the web T70 model instead')}</strong>
                  {urlProblem && <p className="pixel-stream-hint">{urlProblem}</p>}
                  {!urlProblem && <p>{t('信令服务器不可达或没有在线的虚幻流。请检查信令地址与服务器状态后重试。', 'The signalling server is unreachable or no Unreal streamer is online. Check the signalling address and server status, then retry.')}</p>}
                </>
              )}
              {status === 'disconnected' && <p>{t('已断开像素流。下面的网页版 T70 模型仍可交互；需要时可重新连接。', 'Pixel stream disconnected. The web T70 model below is still interactive; reconnect when needed.')}</p>}
            </div>
          )}
        </div>

        <div className="pixel-stream-controls">
          <Button
            type="button"
            onClick={() => void handleConnect()}
            disabled={status === 'unconfigured' || status === 'connecting' || status === 'connected'}
            className="gap-2"
          >
            <PlugZap size={16} />
            {status === 'failed' || status === 'disconnected' ? t('重新连接', 'Reconnect') : t('连接像素流', 'Connect stream')}
          </Button>
          <Button type="button" variant="outline" onClick={handleDisconnect} disabled={status !== 'connecting' && status !== 'connected'} className="gap-2">
            <Power size={16} />{t('断开', 'Disconnect')}
          </Button>
          <Button type="button" variant="outline" onClick={toggleFullscreen} className="gap-2">
            <Maximize size={16} />{isFullscreen ? t('退出全屏', 'Exit fullscreen') : t('全屏', 'Fullscreen')}
          </Button>
          <span className="pixel-stream-config-note">
            {configured.url ? t('信令地址：已配置', 'Signalling address: configured') : t('信令地址：未配置', 'Signalling address: not configured')}
          </span>
        </div>
        <p className="pixel-stream-note">
          {t('连接后，鼠标、键盘与触屏输入由官方像素流库透传给虚幻端；断线时请用“重新连接”。流未接通前，本节下方始终是可交互的网页版 T70 模型。', 'Once connected, mouse, keyboard and touch input are forwarded to Unreal by the official Pixel Streaming library; use Reconnect after a drop. Until a stream is live, the interactive web T70 model below is always available.')}
        </p>
      </div>

      {showFallback && (
        <div className="pixel-fallback">
          <div className="pixel-fallback-head">
            <div>
              <p className="pixel-stream-kicker">{t('网页版回落', 'Web fallback')}</p>
              <h3>{t('鸿鹄 T70 · 网页模型', 'Honghu T70 · web model')}</h3>
              <p>{t('拖动旋转、滚轮缩放；点模型或点下方零件芯片查看标注；WASD 或右下方向键漫游，自动环绕可随时恢复。', 'Drag to orbit, scroll to zoom; click the model or a part chip below for its label; WASD or the on-screen pad roams, and auto-orbit can be resumed anytime.')}</p>
            </div>
            <div className="pixel-fallback-actions">
              <Button type="button" variant="outline" size="sm" onClick={() => setAutoOrbit(value => !value)} className="gap-2">
                {autoOrbit ? <Pause size={15} /> : <Play size={15} />}{autoOrbit ? t('暂停环绕', 'Pause orbit') : t('自动环绕', 'Auto-orbit')}
              </Button>
              {selected && (
                <Button type="button" variant="ghost" size="sm" onClick={() => selectPart(null)} className="gap-2">
                  <X size={15} />{t('清除选中', 'Clear selection')}
                </Button>
              )}
            </div>
          </div>

          {!modelFailed && (
            <Suspense fallback={<div className="pixel-fallback-loading">{t('模型加载中…', 'Loading model…')}</div>}>
              <T70FallbackScene
                selected={selected}
                autoOrbit={autoOrbit}
                onParts={setFallbackParts}
                onSelect={name => selectPart(name)}
                onReady={() => setModelReady(true)}
                onFailed={() => setModelFailed(true)}
                onUserInteract={() => setAutoOrbit(false)}
              />
            </Suspense>
          )}
          {!modelFailed && !modelReady && (
            <div className="pixel-fallback-loading">{t('模型加载中…', 'Loading model…')}</div>
          )}
          {modelFailed && (
            <figure className="pixel-fallback-photo">
              <img src={publicAsset('models/t70-parts/preview_assembled.png')} alt={t('鸿鹄 T70 整机预览图', 'Honghu T70 assembled preview')} />
              <figcaption>{t('网页模型加载失败（WebGL 或模型文件不可用），显示仓库已有的 T70 整机预览图。', 'The web model failed to load (WebGL or the model file is unavailable); showing the assembled T70 preview already in the repo.')}</figcaption>
            </figure>
          )}

          <div className="pixel-part-chips" aria-label={t('T70 零件', 'T70 parts')}>
            {orderedParts.map(part => (
              <button
                key={part.name}
                type="button"
                className={selected === part.name ? 'is-active' : ''}
                aria-pressed={selected === part.name}
                onClick={() => selectPart(selected === part.name ? null : part.name)}
              >
                {partLabel(part.name, part.labelZh)}
              </button>
            ))}
          </div>

          <div className="pixel-part-card" aria-live="polite">
            {selectedPart ? (
              <>
                <strong>{selectedTitle}</strong>
                <span className="pixel-part-id">{selectedPart.name}</span>
                <p>{t('T70 模型文件仅含外壳、车轮与传感器件；发动机、变速箱、PTO、液压提升等内件不在该文件中，此处不作标注。', 'The T70 model file contains only shell, wheel and sensor parts; engine, gearbox, PTO, hydraulic lift and other internals are not in this file and are not labelled here.')}</p>
              </>
            ) : (
              <p>{t('点一个零件查看它的中文名。T70 文件共 14 个零件，见上方芯片。', 'Pick a part to see its Chinese name. The T70 file has 14 parts, shown as chips above.')}</p>
            )}
          </div>

          <p className="pixel-fallback-more">
            <Link to="/models" onPointerEnter={() => preloadPage('/models')} onFocus={() => preloadPage('/models')}>
              {/* Inline span color: the old shell recolors bare links, and a
                  child's own color beats an inherited link color. */}
              <span style={{ color: '#d6efff', fontWeight: 600 }}>{t('进入模型工坊', 'Open the model studio')}</span><ArrowRight size={15} />
            </Link>
            <button type="button" onClick={() => void handleReconnect()} disabled={status === 'unconfigured' || status === 'connecting'}>
              <RotateCcw size={14} />{t('重试像素流', 'Retry pixel stream')}
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
