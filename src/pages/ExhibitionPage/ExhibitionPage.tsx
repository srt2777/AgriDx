import {
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { AnimatePresence, useReducedMotion } from 'framer-motion';
import FloatingPanel from '@/components/FloatingPanel';
import { LiquidSelection } from '@/components/ui/liquid-selection';
import { LiquidGlass } from '@/components/ui/liquid-glass';
import DeferredScene from '@/components/DeferredScene';
import SceneFallback from '@/components/SceneFallback';
import { preloadPage } from '@/lib/page-loaders';
import { probeWebGL, type GraphicsReason } from '@/lib/webgl';
import { useLang } from '@/hooks/useLang';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import { StatTicker } from '@/components/StatTicker';
import { beginSharedTransition, sharedTransitionName } from '@/lib/shared-transition';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';
import { campusIntroPlan } from './intro-timing';
import {
  initialDriveState,
  KEY_ACTIONS,
  WORLD_ZONES,
  pavilionDestination,
  type DriveAction,
  type WorldMode,
  type ZoneId,
} from './world-navigation';
import type { WorldInput } from './ExhibitionWorld';
import CampusEquipmentCatalog from '@/features/campus-equipment/CampusEquipmentCatalog';
import { HALL_EXAMPLE_DEVICES, HALL_ZONES, HALL_STATUS_EXAMPLE } from '@/features/campus-equipment/hall-example-data';
import { exhibitForDevice } from '@/features/campus-equipment/campus-layout';
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
  const lang = useLang();
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const equipmentRequest = params.get('equipment');
  const reducedMotion = !!useReducedMotion();
  const stage = useRef<HTMLElement>(null);
  const [flight, setFlight] = useState(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!campusIntroPlan(reduced).play) return false;
    try { return sessionStorage.getItem('agridx-campus-intro') !== '1'; } catch { return false; }
  });
  const [intro, setIntro] = useState(flight);
  const [landed, setLanded] = useState(false);
  const endFlight = useCallback(() => setFlight(false), []);
  const endIntro = useCallback(() => {
    const skipFocused = document.activeElement instanceof HTMLElement && !!document.activeElement.closest('.expo-intro-skip');
    try { sessionStorage.setItem('agridx-campus-intro', '1'); } catch { /* private mode keeps the intro for this load only */ }
    setFlight(false);
    setIntro(false);
    setLanded(true);
    if (skipFocused) stage.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!intro) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') endIntro();
    };
    const timer = window.setTimeout(endIntro, campusIntroPlan(false).holdMs);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [intro, endIntro]);
  const [graphics, setGraphics] = useState<GraphicsReason | 'live'>(() => (probeWebGL() ? 'loading' : 'unsupported'));
  const [coarse, setCoarse] = useState(() => window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const onLive = useCallback(() => setGraphics('live'), []);
  const onLost = useCallback(() => setGraphics((current) => (current === 'unsupported' ? current : 'lost')), []);
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const apply = () => setCoarse(media.matches);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  const { catalog, loading, failed, retry } = useKnowledgeCatalog();
  const [mode, setMode] = useState<WorldMode>('overview');
  const [selected, setSelected] = useState<ZoneId | null>(null);
  const [focus, setFocus] = useState<ZoneId | null>(null);
  const [nearby, setNearby] = useState<ZoneId | null>(null);
  const [destination, setDestination] = useState<{ id: ZoneId; revision: number } | null>(null);
  const [reset, setReset] = useState(0);
  const [position, setPosition] = useState(initialDriveState);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [tractorOpen, setTractorOpen] = useState(false);
  const [equipmentId, setEquipmentId] = useState<string | null>(null);
  const [equipmentMoving, setEquipmentMoving] = useState(false);
  const equipmentClose = useRef<HTMLButtonElement>(null);
  const equipmentTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (equipmentId) equipmentClose.current?.focus({ preventScroll: true });
  }, [equipmentId]);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
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
      setEquipmentId(null);
      setTractorOpen(false);
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
      if (equipmentId) { closeEquipment(); return; }
      setEquipmentId(null);
      setTractorOpen(false);
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
    setEquipmentId(null);
    setTractorOpen(false);
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
    setEquipmentId(null);
    stopInput();
    setMode('overview');
    setFocus(null);
    setDestination(null);
  }
  function resetWorld() {
    setTractorOpen(false);
    overview();
    setSelected(null);
    setReset((value) => value + 1);
  }
  const openEquipment = useCallback((id: string) => {
    if (!HALL_EXAMPLE_DEVICES.some(item => item.id === id)) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) equipmentTrigger.current = document.activeElement;
    stopInput(); setMode('overview'); setFocus(null); setSelected(null); setTractorOpen(false); setCatalogOpen(false); setEquipmentId(id);
    stage.current?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }, [stopInput]);
  function closeEquipment() {
    setEquipmentId(null);
    const target = equipmentTrigger.current?.isConnected ? equipmentTrigger.current : stage.current;
    target?.focus();
  }
  useEffect(() => {
    if (!equipmentRequest) return;
    endIntro();
    if (equipmentRequest === 'all') {
      document.getElementById('campus-equipment-catalog')?.scrollIntoView({ behavior: 'instant', block: 'start' });
    } else {
      const device = HALL_EXAMPLE_DEVICES.find(item => item.id === equipmentRequest || item.zone === equipmentRequest);
      if (device) openEquipment(device.id);
    }
  }, [equipmentRequest, endIntro, openEquipment]);
  function enterZone(id: ZoneId, source?: Element | null) {
    stopInput();
    const destination = pavilionDestination(id);
    const go = () => navigate(destination.path);
    const name = sharedTransitionName('pavilion', id);
    if (!name) {
      go();
      return;
    }
    beginSharedTransition(name, go, source ?? null);
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
  const equipment = HALL_EXAMPLE_DEVICES.find(item => item.id === equipmentId);
  const equipmentZone = HALL_ZONES.find(item => item.id === equipment?.zone);
  const equipmentStatus = HALL_STATUS_EXAMPLE.find(item => item.id === equipment?.status);
  const detail = selected ? ZONE_DETAILS[selected] : null;
  const ActiveIcon = selected ? ZONE_ICONS[selected] : Compass;
  const totals = !failed ? catalog?.totals : undefined;
  const models = (catalog?.brands ?? []).flatMap((brand) =>
    brand.models.map((model) => ({ ...model, brandId: brand.id, brandName: brand.name })),
  );
  const filtered = models.filter((model) =>
    `${model.name} ${model.brandName}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className={`expo-page${landed ? ' is-landed' : ''}`} data-ui-version="new" data-intro={intro ? '' : undefined} data-flight={flight ? '' : undefined}>
      <div className="expo-main">
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
          {intro && (
            <button type="button" className="expo-intro-skip" onClick={endIntro} autoFocus>
              {t('跳过', 'Skip')}
            </button>
          )}
          <div className={`expo-world-canvas${graphics === 'live' ? ' is-live' : ''}`}>
            <SceneFallback kind="campus" reason={graphics === 'live' ? 'loading' : graphics} hidden={graphics === 'live'} />
            {(graphics === 'loading' || graphics === 'live') && <DeferredScene
              priority
              fallback={null}
            >
              <ExhibitionWorld
                mode={mode}
                selected={selected}
                focus={focus}
                destination={destination}
                reset={reset}
                input={input}
                reducedMotion={reducedMotion}
                cinematic={flight}
                onCinematicEnd={endFlight}
                onLive={onLive}
                onLost={onLost}
                onSelect={selectZone}
                equipmentFocus={equipmentId}
                equipmentMoving={equipmentMoving && !reducedMotion}
                onEquipmentSelect={openEquipment}
                onTractorSelect={() => {
                  setEquipmentId(null);
                  stopInput(); setMode('overview'); setCatalogOpen(false); setSelected(null); setFocus(null); setTractorOpen(true);
                }}
                onPosition={setPosition}
                onNearby={onNearby}
              />
            </DeferredScene>}
          </div>
          <div className="expo-world-vignette" aria-hidden="true" />
          <AnimatePresence initial={false}>{selectedZone && detail && !catalogOpen && !equipmentId && (
            <FloatingPanel
              key={selectedZone.id}
              as="aside"
              className={PREMIUM_MOTION_ENABLED ? 'expo-zone-card is-beamed' : 'expo-zone-card'}
              glass
              beam={PREMIUM_MOTION_ENABLED}
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
                {selectedZone.id === 'diagnosis' && <Link className="expo-fault-link" to="/fault-detection" onPointerEnter={() => preloadPage('/fault-detection')} onFocus={() => preloadPage('/fault-detection')}>
                  {t('故障检测演示工作台', 'Fault detection demo workbench')}<ArrowRight size={15} />
                </Link>}
                <button type="button" className={PREMIUM_MOTION_ENABLED ? 'glass-press' : undefined} data-motion={PREMIUM_MOTION_ENABLED ? 'glass-press' : undefined} onPointerEnter={() => preloadPage(selectedZone.path ?? '/', selectedZone.path ? 'new' : 'old')} onFocus={() => preloadPage(selectedZone.path ?? '/', selectedZone.path ? 'new' : 'old')} onClick={(event) => enterZone(selectedZone.id, event.currentTarget.closest('.expo-zone-card')?.querySelector('h2') ?? event.currentTarget)}>
                  {t('进入展区', 'Open zone')}
                  <ArrowRight size={15} />
                </button>
                <button
                  type="button"
                  className={PREMIUM_MOTION_ENABLED ? 'expo-visit-button glass-press' : 'expo-visit-button'}
                  onClick={() => visitZone(selectedZone.id)}
                >
                  <MoveUpRight size={14} />
                  {t('驶向这里', 'Drive here')}
                </button>
              </div>
            </FloatingPanel>
          )}</AnimatePresence>
          <AnimatePresence initial={false}>{equipment && !catalogOpen && <FloatingPanel key={`equipment-${equipment.id}`} as="aside" className="expo-zone-card campus-equipment-detail" glass label={t('装备示例详情', 'Example equipment detail')}>
            <div className="expo-zone-card-top"><span>{t('装备详情', 'Equipment details')}</span><button ref={equipmentClose} type="button" className="expo-icon-button" aria-label={t('关闭装备详情', 'Close equipment detail')} onClick={closeEquipment}><X size={16} /></button></div>
            <h2>{equipment.name}</h2><p>{t('示例数据 · 未接实车与传感器。陈列为结构示意，不是该型号的精确模型。', 'Example data · no physical machine or sensors. The exhibit is a schematic, not an exact model.')}</p>
            <dl><dt>{t('分类', 'Category')}</dt><dd>{equipmentZone && t(equipmentZone.zh, equipmentZone.en)}</dd><dt>{t('示例状态', 'Example status')}</dt><dd>{equipmentStatus && t(equipmentStatus.zh, equipmentStatus.en)}</dd><dt>{t('示例规格', 'Example specs')}</dt><dd>{t(equipment.specZh, equipment.specEn)}</dd><dt>{t('示例管理人', 'Example manager')}</dt><dd>{equipment.manager}</dd></dl>
            {exhibitForDevice(equipment.id)?.id !== equipment.id && <p>{t('本记录没有独立模型，镜头定位到同分类代表示意。', 'No dedicated model for this record; the camera shows a representative of its category.')}</p>}
            <div className="expo-zone-actions"><Link className="expo-fault-link" to={`/knowledge?${new URLSearchParams({ collection: 'archive', q: equipment.name })}`}>{t('按名称查找资料', 'Search evidence by name')}<ArrowRight size={15} /></Link><Link className="expo-fault-link" to="/models">{t('打开模型工坊', 'Open model studio')}<ArrowRight size={15} /></Link><Link className="expo-fault-link" to="/fault-detection">{t('故障检测演示', 'Fault detection demo')}<ArrowRight size={15} /></Link></div>
          </FloatingPanel>}</AnimatePresence>
          <AnimatePresence initial={false}>{tractorOpen && !catalogOpen && <FloatingPanel key="tractor-preview" as="aside" className="expo-zone-card" glass label={t('中央拖拉机预览', 'Central tractor preview')}>
            <div className="expo-zone-card-top"><span>{t('中央拖拉机', 'CENTRAL TRACTOR')}</span><button type="button" className="expo-icon-button" aria-label={t('关闭拖拉机预览', 'Close tractor preview')} onClick={() => setTractorOpen(false)}><X size={16} /></button></div>
            <h2>{t('从结构到故障排查', 'Structure to fault checks')}</h2>
            <p>{t('园区车辆仅用于导航。故障工作台使用独立柴油结构示意与模拟数据，不是此车的实测数据。', 'The campus vehicle is for navigation. The workbench uses a separate diesel schematic and simulated data, not measurements from this vehicle.')}</p>
            <div className="expo-zone-actions"><Link className="expo-fault-link" to="/fault-detection">{t('故障检测演示', 'Fault detection demo')}<ArrowRight size={15} /></Link><Link className="expo-fault-link" to="/models">{t('查看模型结构', 'View model structure')}<ArrowRight size={15} /></Link><button type="button" onClick={startDrive}>{t('继续园区漫游', 'Continue campus exploration')}<Navigation size={15} /></button></div>
          </FloatingPanel>}</AnimatePresence>
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
                  <strong><StatTicker value={totals?.archivedEntries} reduced={reducedMotion} /></strong>
                  <span>{t('机型归档条目', 'MODEL ARCHIVE ENTRIES')}</span>
                </div>
                <div>
                  <strong><StatTicker value={totals?.sources} reduced={reducedMotion} /></strong>
                  <span>{t('来源', 'SOURCES')}</span>
                </div>
                <div>
                  <strong><StatTicker value={totals?.models} reduced={reducedMotion} /></strong>
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
                <span className="expo-map-north" aria-hidden="true">N</span>
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
                    <span>{zone.number}</span>
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
              <button ref={catalogTrigger} type="button" aria-expanded={catalogOpen} aria-controls="world-catalog" aria-label={t('查找资料', 'Find evidence')} title={t('查找资料', 'Find evidence')} onClick={() => { stopInput(); setMode('overview'); setCatalogOpen(value => !value); }}><Search size={17} /></button>
              <button type="button" onClick={() => void fullscreen()} aria-label={t('切换全屏', 'Toggle full screen')} title={t('切换全屏', 'Toggle full screen')}><Maximize size={17} /></button>
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
                  <span>{coarse ? t('单指拖动环视 · 双指缩放', 'DRAG TO ORBIT · PINCH TO ZOOM') : t('拖动环视 · 滚轮缩放', 'DRAG TO ORBIT · SCROLL TO ZOOM')}</span>
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
        <CampusEquipmentCatalog onSelect={openEquipment} moving={equipmentMoving && !reducedMotion} onMotion={() => setEquipmentMoving(value => !value)} reduced={reducedMotion} />
      </div>
      {notice && (
        <div className="expo-notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
