import { publicAsset } from '@/lib/public-asset';
import {
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useId,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  Cpu,
  Globe,
  Layers3,
  Map as MapIcon,
  Maximize,
  MoveUpRight,
  Navigation,
  RotateCcw,
  Search,
  Tractor,
  X,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion';
import VersionSwitch from '@/components/VersionSwitch';
import ThemeSwitch from '@/components/ThemeSwitch';
import FloatingPanel from '@/components/FloatingPanel';
import { LiquidSelection } from '@/components/ui/liquid-selection';
import { LiquidGlass } from '@/components/ui/liquid-glass';
import DeferredScene from '@/components/DeferredScene';
import { preloadPage } from '@/lib/page-loaders';
import { useLang, setLang } from '@/hooks/useLang';
import { setUiVersion } from '@/hooks/useUiVersion';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import { version as appVersion } from '../../../package.json';
import {
  initialDriveState,
  KEY_ACTIONS,
  WORLD_ZONES,
  type DriveAction,
  type WorldMode,
  type ZoneId,
} from './world-navigation';
import type { WorldInput } from './ExhibitionWorld';
import './exhibition.css';

const ExhibitionWorld = lazy(() => import('./ExhibitionWorld'));
const ZONE_ICONS = { knowledge: BookOpen, diagnosis: Cpu, models: Tractor, research: Layers3 };
const ZONE_DETAILS = {
  knowledge: {
    zh: '从品牌与型号出发，找到适用资料。',
    en: 'Find the right evidence for your machine.',
    descZh: '沿品牌、型号、组件与零部件浏览，核对原文、页码和适用范围。',
    descEn: 'Browse brands, models, components and parts with original sources and scope.',
    tagsZh: ['四级资料浏览', '来源可追溯'],
    tagsEn: ['Four-level catalog', 'Traceable sources'],
  },
  diagnosis: {
    zh: '带着故障现象，寻找排查的起点。',
    en: 'Turn symptoms into a clear starting point.',
    descZh: '补充品牌、机型和发生工况，结合现有资料整理原因线索与分步建议。',
    descEn: 'Describe the model, symptoms and conditions to explore source-backed guidance.',
    tagsZh: ['对话式排查', '资料边界明示'],
    tagsEn: ['Diagnostic dialogue', 'Visible evidence scope'],
  },
  models: {
    zh: '从整机到组件，看清结构关系。',
    en: 'Explore the machine, one component at a time.',
    descZh: '切换视角、选择组件、展开结构，也可导入自己的 GLB 模型。',
    descEn: 'Change views, select components, explore an exploded schematic or import a GLB.',
    tagsZh: ['交互结构示意', '本地模型导入'],
    tagsEn: ['Interactive schematic', 'Local model import'],
  },
  research: {
    zh: '回到方法与文献，理解每一步依据。',
    en: 'Explore the methods behind the platform.',
    descZh: '查看论文入口、建设路线与验证记录，了解当前能力和研究方向。',
    descEn: 'Read research references, the development path and validation boundaries.',
    tagsZh: ['研究文献', '验证记录'],
    tagsEn: ['Research references', 'Validation records'],
  },
};

export default function ExhibitionPage() {
  const zoneSelection = useId();
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const navigate = useNavigate();
  const reducedMotion = !!useReducedMotion();
  const { catalog, loading, failed, retry } = useKnowledgeCatalog();
  const [mode, setMode] = useState<WorldMode>('overview');
  const [selected, setSelected] = useState<ZoneId | null>(null);
  const [focus, setFocus] = useState<ZoneId | null>(null);
  const [nearby, setNearby] = useState<ZoneId | null>(null);
  const [destination, setDestination] = useState<{ id: ZoneId; revision: number } | null>(null);
  const [reset, setReset] = useState(0);
  const [position, setPosition] = useState(initialDriveState);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const stage = useRef<HTMLElement>(null);
  const [input] = useState<WorldInput>(() => ({ actions: new Map() }));
  const searchInput = useRef<HTMLInputElement>(null);
  const catalogTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      preloadPage('/knowledge');
      preloadPage('/chat');
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);
  const stopInput = useCallback(() => {
    input.actions.clear();
    input.wake?.();
    setDestination(null);
  }, [input]);
  const onNearby = useCallback((id: ZoneId | null) => {
    setNearby(id);
    if (id) setSelected(id);
  }, []);
  const selectZone = useCallback(
    (id: ZoneId) => {
      setSelected(id);
      setFocus(id);
      setMode('overview');
      setDestination(null);
      input.actions.clear();
      input.wake?.();
    },
    [input],
  );
  useEffect(() => {
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      input.actions.delete(`key:${event.code}`);
      input.wake?.();
    };
    const onVisibility = () => {
      if (document.hidden) stopInput();
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stopInput);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopInput);
      document.removeEventListener('visibilitychange', onVisibility);
      stopInput();
    };
  }, [stopInput, input]);
  useEffect(() => {
    const onSearchKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.isComposing &&
        !target.isContentEditable &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        event.preventDefault();
        stopInput();
        setMode('overview');
        setCatalogOpen(true);
      }
    };
    window.addEventListener('keydown', onSearchKey);
    return () => window.removeEventListener('keydown', onSearchKey);
  }, [stopInput]);
  useEffect(() => {
    if (catalogOpen) {
      stopInput();
      searchInput.current?.focus();
    }
  }, [catalogOpen, stopInput]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function handleDriveKey(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') {
      stopInput();
      if (catalogOpen) {
        setCatalogOpen(false);
        catalogTrigger.current?.focus();
      } else {
        setMode('overview');
        setDestination(null);
        setFocus(null);
      }
      return;
    }
    if (
      mode !== 'drive' ||
      event.nativeEvent.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      target.isContentEditable ||
      target.closest('input, textarea, select, button, a')
    )
      return;
    const action = KEY_ACTIONS[event.code];
    if (action) {
      event.preventDefault();
      input.actions.set(`key:${event.code}`, action);
      input.wake?.();
    }
  }
  function startDrive() {
    setMode('drive');
    setFocus(null);
    setCatalogOpen(false);
    setDestination(null);
    stopInput();
    stage.current?.focus({ preventScroll: true });
  }
  function visitZone(id: ZoneId) {
    startDrive();
    setDestination((value) => ({ id, revision: (value?.revision ?? 0) + 1 }));
  }
  function overview() {
    stopInput();
    setMode('overview');
    setFocus(null);
    setDestination(null);
  }
  function resetWorld() {
    overview();
    setSelected(null);
    setReset((value) => value + 1);
  }
  function enterZone(id: ZoneId) {
    stopInput();
    const zone = WORLD_ZONES.find((item) => item.id === id)!;
    if (zone.path) navigate(zone.path);
    else {
      setUiVersion('old');
      navigate('/', { state: { scrollTo: 'research' } });
    }
  }
  function pointerDrive(event: PointerEvent<HTMLButtonElement>, action: DriveAction) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    input.actions.set(`pointer:${event.pointerId}`, action);
    input.wake?.();
  }
  function releasePointer(event: PointerEvent<HTMLButtonElement>) {
    input.actions.delete(`pointer:${event.pointerId}`);
    input.wake?.();
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice(t('可使用浏览器菜单进入全屏。', 'Use your browser menu to enter full screen.'));
    }
  }
  const selectedZone = WORLD_ZONES.find((zone) => zone.id === selected);
  const detail = selected ? ZONE_DETAILS[selected] : null;
  const ActiveIcon = selected ? ZONE_ICONS[selected] : Compass;
  const totals = !failed ? catalog?.totals : undefined;
  const number = (value: number | undefined) => (value === undefined ? '—' : value.toLocaleString());
  const models = (catalog?.brands ?? []).flatMap((brand) =>
    brand.models.map((model) => ({ ...model, brandId: brand.id, brandName: brand.name })),
  );
  const filtered = models.filter((model) =>
    `${model.name} ${model.brandName}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="expo-page" data-ui-version="new">
      <a
        className="skip-link"
        href="#expo-main"
        onClick={(event) => {
          event.preventDefault();
          stage.current?.focus({ preventScroll: true });
          stage.current?.scrollIntoView({ block: 'start' });
        }}
      >
        {t('跳到主要内容', 'Skip to content')}
      </a>
      <header className="expo-header">
        <div className="expo-brand">
          <a
            href="https://coe.njau.edu.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="expo-college-mark"
            aria-label={t('南京农业大学工学院官网首页', 'College of Engineering, NAU official homepage')}
          >
            <img
              src={publicAsset('images/njau-engineering-mark.jpg')}
              alt={t('南京农业大学工学院院徽', 'College of Engineering, NAU emblem')}
              width="857"
              height="411"
            />
          </a>
          <Link to="/" className="expo-wordmark">
            <strong>耕知 · 耘诊</strong>
            <small>AGRIDX / SPATIAL EXPLORATION</small>
          </Link>
        </div>
        <div className="expo-title">
          <span>KNOWLEDGE IN EVERY DIRECTION</span>
          <h1>{t('农机装备数字展示大厅', 'Agricultural equipment hub')}</h1>
        </div>
        <LiquidGlass lens variant="clear" displacementScale={24} className="expo-header-glass" contentClassName="expo-header-tools">
          <VersionSwitch exhibition />
          <ThemeSwitch />
          <button
            type="button"
            className="expo-icon-button"
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            aria-label={t('切换语言', 'Switch language')}
          >
            <Globe size={17} />
            <span>{lang === 'zh' ? 'EN' : '中'}</span>
          </button>
          <button
            type="button"
            className="expo-icon-button expo-fullscreen"
            onClick={() => void fullscreen()}
            aria-label={t('切换全屏', 'Toggle full screen')}
          >
            <Maximize size={17} />
          </button>
        </LiquidGlass>
      </header>
      <main id="expo-main" className="expo-main">
        <div className="expo-scene-bar">
          <span>
            <i />
            {t('原创三维园区 · 四个功能展区', 'ORIGINAL 3D CAMPUS · FOUR FEATURE ZONES')}
          </span>
          <button
            ref={catalogTrigger}
            type="button"
            className="expo-catalog-trigger"
            aria-expanded={catalogOpen}
            aria-controls="world-catalog"
            onClick={() => {
              stopInput();
              setMode('overview');
              setCatalogOpen(!catalogOpen);
            }}
          >
            <Search size={15} />
            {t('查找设备资料', 'Find machine evidence')}
            <kbd>/</kbd>
          </button>
        </div>
        <section
          ref={stage}
          className="expo-world-stage"
          tabIndex={0}
          aria-label={t(
            '可漫游三维园区。选择漫游后，用 W A S D 或方向键移动，空格刹车，Esc 返回总览。',
            'Explorable 3D campus. Start exploring, then use WASD or arrows to drive, Space to brake, Escape for overview.',
          )}
          onKeyDown={handleDriveKey}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) stopInput();
          }}
          data-mode={mode}
          data-tractor-x={position.x.toFixed(2)}
          data-tractor-z={position.z.toFixed(2)}
        >
          <div className="expo-world-canvas">
            <DeferredScene
              priority={mode === 'drive' || focus !== null || destination !== null || reset > 0}
              fallback={
                <div className="world-loading" role="status">
                  {t('正在打开三维园区…', 'Opening the 3D campus…')}
                </div>
              }
            >
              <ExhibitionWorld
                mode={mode}
                selected={selected}
                focus={focus}
                destination={destination}
                reset={reset}
                input={input}
                reducedMotion={reducedMotion}
                onSelect={selectZone}
                onPosition={setPosition}
                onNearby={onNearby}
              />
            </DeferredScene>
          </div>
          <div className="expo-world-vignette" aria-hidden="true" />
          <aside className="expo-world-guide">
            <div className="expo-guide-eyebrow">
              <Compass size={15} />
              <span>THE EXPLORATION CAMPUS</span>
            </div>
            <h2>
              {t('把探索，', 'A new dimension.')}
              <br />
              <span>{t('带入三维。', 'A clearer connection.')}</span>
            </h2>
            <p>
              {t(
                '驾驶拖拉机穿行园区，沿不同展区连接结构、知识与诊断。',
                'Drive through the campus to discover structure, knowledge and diagnosis.',
              )}
            </p>
            <button type="button" className="expo-start-button" onClick={startDrive}>
              <Navigation size={16} />
              {mode === 'drive' ? t('继续漫游', 'Continue exploring') : t('开始漫游', 'Start exploring')}
              <ArrowUpRight size={16} />
            </button>
            <LiquidGlass lens displacementScale={24} className="expo-guide-glass"><LayoutGroup id={zoneSelection}><nav className="expo-zone-nav" aria-label={t('展区导览', 'Zone guide')}>
              {WORLD_ZONES.map((zone) => {
                const Icon = ZONE_ICONS[zone.id];
                return (
                  <button
                    type="button"
                    key={zone.id}
                    onClick={() => selectZone(zone.id)}
                    aria-pressed={selected === zone.id}
                    style={{ '--zone-color': zone.color } as CSSProperties}
                  >
                    {selected === zone.id && <LiquidSelection className="expo-zone-selection" />}
                    <span>{zone.number}</span>
                    <Icon size={17} strokeWidth={1.5} />
                    <strong>{t(zone.zh, zone.en)}</strong>
                    <ArrowUpRight size={13} />
                  </button>
                );
              })}
            </nav></LayoutGroup></LiquidGlass>
          </aside>
          <div className="expo-world-coordinate" aria-hidden="true">
            <span>AGRIDX CAMPUS / 001</span>
            <small>{t('结构与空间示意', 'SCHEMATIC WORLD')}</small>
          </div>
          <AnimatePresence initial={false}>{selectedZone && detail && !catalogOpen && (
            <FloatingPanel
              key={selectedZone.id}
              as="aside"
              className="expo-zone-card"
              glass
              style={{ '--zone-color': selectedZone.color } as CSSProperties}
              label={t('当前展区', 'Selected zone')}
            >
              <div className="expo-zone-card-top">
                <span>
                  {selectedZone.number} / {t('功能展区', 'FEATURE ZONE')}
                </span>
                <button
                  type="button"
                  className="expo-icon-button"
                  aria-label={t('关闭展区说明', 'Close zone details')}
                  onClick={() => {
                    setSelected(null);
                    setFocus(null);
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <ActiveIcon className="expo-zone-card-icon" size={30} strokeWidth={1.2} />
              <h2>{t(selectedZone.zh, selectedZone.en)}</h2>
              <h3>{t(detail.zh, detail.en)}</h3>
              <p>{t(detail.descZh, detail.descEn)}</p>
              <div className="expo-zone-tags">
                {(lang === 'zh' ? detail.tagsZh : detail.tagsEn).map((tag) => (
                  <span key={tag}>
                    <Check size={11} />
                    {tag}
                  </span>
                ))}
              </div>
              <div className="expo-zone-actions">
                <button type="button" onPointerEnter={() => preloadPage(selectedZone.path ?? '/', selectedZone.path ? 'new' : 'old')} onFocus={() => preloadPage(selectedZone.path ?? '/', selectedZone.path ? 'new' : 'old')} onClick={() => enterZone(selectedZone.id)}>
                  {t('进入展区', 'Open zone')}
                  <ArrowRight size={15} />
                </button>
                <button
                  type="button"
                  className="expo-visit-button"
                  onClick={() => visitZone(selectedZone.id)}
                >
                  <MoveUpRight size={14} />
                  {t('驶向这里', 'Drive here')}
                </button>
              </div>
            </FloatingPanel>
          )}</AnimatePresence>
          <AnimatePresence initial={false}>{catalogOpen && (
            <FloatingPanel
              key="catalog"
              as="aside"
              id="world-catalog"
              className="expo-catalog-sheet"
              glass
              label={t('设备资料目录', 'Machine evidence catalog')}
            >
              <div className="expo-sheet-heading">
                <div>
                  <span>THE KNOWLEDGE ARCHIVE</span>
                  <h2>{t('设备资料', 'Machine evidence')}</h2>
                </div>
                <button
                  type="button"
                  className="expo-icon-button"
                  aria-label={t('关闭资料目录', 'Close evidence catalog')}
                  onClick={() => {
                    setCatalogOpen(false);
                    catalogTrigger.current?.focus();
                  }}
                >
                  <X size={19} />
                </button>
              </div>
              <div className="expo-sheet-counts">
                <div>
                  <strong>{number(totals?.archivedEntries)}</strong>
                  <span>{t('机型归档条目', 'MODEL ARCHIVE ENTRIES')}</span>
                </div>
                <div>
                  <strong>{number(totals?.sources)}</strong>
                  <span>{t('来源', 'SOURCES')}</span>
                </div>
                <div>
                  <strong>{number(totals?.models)}</strong>
                  <span>{t('型号 / 系列', 'MODELS / SERIES')}</span>
                </div>
              </div>
              <label className="expo-search">
                <Search size={16} />
                <input
                  ref={searchInput}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value.slice(0, 100))}
                  placeholder={t('搜索品牌或型号', 'Search brand or model')}
                  aria-label={t('搜索设备资料', 'Search machine evidence')}
                />
              </label>
              <div className="expo-catalog-list" aria-live="polite">
                {loading ? (
                  <div className="expo-catalog-state" role="status">
                    <p>{t('正在读取知识目录…', 'Loading the catalog…')}</p>
                    <div className="expo-catalog-skeleton" aria-hidden="true"><span /><span /><span /></div>
                  </div>
                ) : failed ? (
                  <div className="expo-catalog-state" role="alert">
                    <p>{t('知识目录暂不可用', 'Catalog unavailable')}</p>
                    <button type="button" onClick={retry}>
                      {t('重新加载', 'Retry')}
                    </button>
                  </div>
                ) : filtered.length ? (
                  filtered.map((model) => (
                    <Link
                      key={`${model.brandId}/${model.id}`}
                      to={`/knowledge?${new URLSearchParams({ brand: model.brandId, model: model.id })}`}
                      onPointerEnter={() => preloadPage('/knowledge')}
                      onFocus={() => preloadPage('/knowledge')}
                      className="expo-catalog-row"
                    >
                      <div>
                        <strong>{model.name}</strong>
                        <small>
                          {model.brandName} · {model.entryCount} {t('条资料', 'entries')}
                        </small>
                      </div>
                      <span className={`expo-scope scope-${model.scope}`}>
                        {model.scope === 'exact'
                          ? t('具体型号', 'Model')
                          : model.scope === 'series'
                            ? t('系列', 'Series')
                            : t('待核实', 'Pending')}
                      </span>
                    </Link>
                  ))
                ) : (
                  <div className="expo-catalog-state">
                    {t(
                      '没有匹配的资料，请试试其他品牌或型号。',
                      'No matching documents. Try another brand or model.',
                    )}
                  </div>
                )}
              </div>
              <p className="expo-catalog-note">
                {t(
                  '目录数量不代表全机型覆盖，机型与配置须核对。',
                  'Archive counts do not imply complete coverage. Check the model and configuration.',
                )}
              </p>
              <Link className="expo-catalog-all" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
                {t('打开完整知识库', 'Open the complete catalog')}
                <ArrowRight size={14} />
              </Link>
            </FloatingPanel>
          )}</AnimatePresence>
          <div className="expo-world-bottom">
            <div className="expo-mini-map" aria-label={t('园区示意地图', 'Campus schematic map')}>
              <span className="expo-map-title">
                <MapIcon size={12} />
                {t('园区导览', 'CAMPUS MAP')}
              </span>
              <div className="expo-map-grid">
                {WORLD_ZONES.map((zone) => (
                  <button
                    type="button"
                    key={zone.id}
                    onClick={() => visitZone(zone.id)}
                    style={
                      {
                        left: `${50 + zone.x * 3}%`,
                        top: `${50 + zone.z * 3.5}%`,
                        '--zone-color': zone.color,
                      } as CSSProperties
                    }
                    aria-label={t(`驶向${zone.zh}`, `Drive to ${zone.en}`)}
                    className={nearby === zone.id ? 'is-nearby' : ''}
                  >
                    {zone.number}
                  </button>
                ))}
                <span
                  className="expo-map-player"
                  style={{
                    left: `${50 + position.x * 3}%`,
                    top: `${50 + position.z * 3.5}%`,
                    transform: `translate(-50%, -50%) rotate(${-position.heading - Math.PI * 0.75}rad)`,
                  }}
                >
                  <Navigation size={11} fill="currentColor" />
                </span>
              </div>
            </div>
            <LiquidGlass lens variant="clear" displacementScale={30} className="expo-dock-glass" contentClassName="expo-world-dock" role="group" aria-label={t('空间控制', 'World controls')}>
              <button type="button" aria-pressed={mode === 'overview' && !focus} onClick={overview}>
                <Compass size={17} />
                <span>{t('园区总览', 'Overview')}</span>
              </button>
              <button type="button" aria-pressed={mode === 'drive'} onClick={startDrive}>
                <Navigation size={16} />
                <span>{t('驾驶漫游', 'Explore')}</span>
              </button>
              <span className="expo-dock-divider" />
              <button type="button" onClick={resetWorld} aria-label={t('回到起点', 'Return to start')}>
                <RotateCcw size={16} />
                <span>{t('回到起点', 'Reset')}</span>
              </button>
            </LiquidGlass>
            <div className="expo-world-hint" aria-live="polite">
              {nearby ? (
                <>
                  <i />
                  {t('已靠近', 'Near')}{' '}
                  {t(
                    WORLD_ZONES.find((zone) => zone.id === nearby)!.zh,
                    WORLD_ZONES.find((zone) => zone.id === nearby)!.en,
                  )}
                </>
              ) : mode === 'drive' ? (
                <>
                  <kbd>W A S D</kbd>
                  <span>{t('或方向键移动', 'or arrow keys to drive')}</span>
                  <small>{t('空格刹车 · Esc 返回总览', 'SPACE TO BRAKE · ESC FOR OVERVIEW')}</small>
                </>
              ) : (
                <>
                  <span>{t('拖动环视 · 滚轮缩放', 'DRAG TO ORBIT · SCROLL TO ZOOM')}</span>
                  <small>{t('点击展区，发现更多', 'SELECT A ZONE TO DISCOVER MORE')}</small>
                </>
              )}
            </div>
          </div>
          {mode === 'drive' && (
            <div
              className="expo-drive-pad"
              role="group"
              aria-label={t('触控驾驶方向', 'Touch driving controls')}
            >
              {(
                [
                  { action: 'forward', icon: ArrowUp, zh: '前进', en: 'Forward' },
                  { action: 'left', icon: ArrowLeft, zh: '左转', en: 'Turn left' },
                  { action: 'backward', icon: ArrowDown, zh: '后退', en: 'Reverse' },
                  { action: 'right', icon: ArrowRight, zh: '右转', en: 'Turn right' },
                ] as const
              ).map((control) => {
                const Icon = control.icon;
                return (
                  <button
                    type="button"
                    key={control.action}
                    className={`drive-${control.action}`}
                    aria-label={t(control.zh, control.en)}
                    onPointerDown={(event) => pointerDrive(event, control.action)}
                    onPointerUp={releasePointer}
                    onPointerCancel={releasePointer}
                    onLostPointerCapture={releasePointer}
                    onKeyDown={(event) => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        input.actions.set(`button:${control.action}`, control.action);
                        input.wake?.();
                      }
                    }}
                    onKeyUp={() => {
                      input.actions.delete(`button:${control.action}`);
                      input.wake?.();
                    }}
                    onBlur={() => {
                      input.actions.delete(`button:${control.action}`);
                      input.wake?.();
                    }}
                  >
                    <Icon size={20} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <div className="expo-evidence-strip">
          <div>
            <span className="expo-strip-label">BUILT ON EVIDENCE</span>
            <strong>{t('探索有空间，知识有依据。', 'Explore with depth. Act with evidence.')}</strong>
          </div>
          <dl>
            <div>
              <dt>{t('知识条目合计', 'KNOWLEDGE ENTRIES')}</dt>
              <dd>{number(totals?.entries)}</dd>
            </div>
            <div>
              <dt>{t('资料来源', 'SOURCES')}</dt>
              <dd>{number(totals?.sources)}</dd>
            </div>
            <div>
              <dt>{t('品牌目录', 'BRANDS')}</dt>
              <dd>{number(totals?.brands)}</dd>
            </div>
          </dl>
          <p>
            {t(
              '原创模型与空间示意；真实传感器与实车孪生尚未接入。',
              'Original schematics. Sensors and physical twins are not integrated.',
            )}
          </p>
        </div>
        <nav className="expo-direct-links" aria-label={t('直接进入功能', 'Direct feature access')}>
          <span>{t('也可以直接出发', 'OR GO DIRECTLY')}</span>
          {WORLD_ZONES.map((zone) => (
            <button type="button" key={zone.id} onPointerEnter={() => preloadPage(zone.path ?? '/', zone.path ? 'new' : 'old')} onFocus={() => preloadPage(zone.path ?? '/', zone.path ? 'new' : 'old')} onClick={() => enterZone(zone.id)}>
              {t(zone.zh, zone.en)}
              <ChevronRight size={14} />
            </button>
          ))}
          <Link className="expo-hall-link" to="/hall" onPointerEnter={() => preloadPage('/hall')} onFocus={() => preloadPage('/hall')}>
            {t('数字展厅', 'Digital hall')}
            <ChevronRight size={14} />
          </Link>
        </nav>
      </main>
      <footer className="expo-footer">
        <span>
          AGRIDX <i />
          {t('南京农业大学工学院 · 农机知识与诊断', 'COLLEGE OF ENGINEERING, NAU · KNOWLEDGE & DIAGNOSIS')}
        </span>
        <span>
          v{appVersion} <i />
          SPATIAL EXPLORATION
        </span>
      </footer>
      {notice && (
        <div className="expo-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
