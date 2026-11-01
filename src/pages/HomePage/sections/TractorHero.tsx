import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Move3d, RotateCw, Pause, Play, Focus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import content, { pick } from '@/data/content';
import { useLang } from '@/hooks/useLang';
import { publicAsset } from '@/lib/public-asset';
import { preloadPage } from '@/lib/page-loaders';
import { TRACTOR_COMPONENTS } from '@/components/tractor-model-info';
import { partChipLabel, partGroup } from './tractor-hero-parts';

/** 标注卡的说明直接取仓库七组部件说明原文，不编造维修参数。 */
function groupInfo(name: string) {
  return TRACTOR_COMPONENTS.find(item => item.id === partGroup(name));
}
import './tractor-hero.css';

const TractorScene = lazy(() => import('./TractorScene'));

export type HeroPart = { name: string; labelZh: string };

export default function TractorHero() {
  const navigate = useNavigate();
  const lang = useLang();
  const h = content.HERO;
  const t = (zh: string, en: string) => (lang === 'zh' ? zh : en);
  const [parts, setParts] = useState<HeroPart[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [mode, setMode] = useState<'orbit' | 'roam'>('orbit');
  const [autoOrbit, setAutoOrbit] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [dof, setDof] = useState(true);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  // 漫游按键集合：useState 初始值身份终身稳定，直接传 Set，不用 ref，
  // 避免渲染期读 ref 触发 lint，也避免回调身份变化导致场景重加载。
  const [roamKeys] = useState(() => new Set<string>());
  const handleReady = useCallback(() => setReady(true), []);
  const handleFailed = useCallback(() => setFailed(true), []);
  const handleUserInteract = useCallback(() => setAutoOrbit(false), []);

  const selectedPart = useMemo(() => parts.find(part => part.name === selected) ?? null, [parts, selected]);

  const select = useCallback((name: string | null) => {
    setSelected(name);
    if (name) {
      const part = parts.find(item => item.name === name);
      setSelectedLabel(part ? partChipLabel(part.name, part.labelZh) : name);
      setAutoOrbit(false);
    }
  }, [parts]);

  useEffect(() => {
    if (mode !== 'roam') return undefined;
    const map: Record<string, string> = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
    };
    const down = (event: KeyboardEvent) => {
      const key = map[event.code];
      if (key) { roamKeys.add(key); event.preventDefault(); }
      if (event.code === 'Escape') setMode('orbit');
    };
    const up = (event: KeyboardEvent) => {
      const key = map[event.code];
      if (key) roamKeys.delete(key);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      roamKeys.clear();
    };
  }, [mode, roamKeys]);

  const roamButton = (key: string, label: string) => ({
    onPointerDown: (event: React.PointerEvent) => { event.preventDefault(); roamKeys.add(key); },
    onPointerUp: () => roamKeys.delete(key),
    onPointerLeave: () => roamKeys.delete(key),
    onPointerCancel: () => roamKeys.delete(key),
    'aria-label': label,
  });

  return (
    <section className="tractor-hero" data-home-beat="hero" aria-label={t('拖拉机模型首页', 'Tractor model home')}>
      <div className={`tractor-hero-canvas${ready && !failed ? ' is-ready' : ''}`}>
        {failed ? (
          <img className="tractor-hero-fallback" src={publicAsset('images/agri-fields.webp')} alt="" />
        ) : (
          <Suspense fallback={<img className="tractor-hero-fallback" src={publicAsset('images/agri-fields.webp')} alt="" />}>
            <TractorScene
              mode={mode}
              autoOrbit={autoOrbit}
              dof={dof}
              selected={selected}
              roamKeys={roamKeys}
              onParts={setParts}
              onSelect={select}
              onReady={handleReady}
              onFailed={handleFailed}
              onUserInteract={handleUserInteract}
            />
          </Suspense>
        )}
      </div>

      <div className="tractor-hero-copy">
        <div className="tractor-hero-eyebrow">{t('南京农业大学工学院 农机智能诊断', 'College of Engineering, NAU Machinery diagnosis')}</div>
        <h1 className="tractor-hero-title">{t('读懂农机故障，', 'Understand machinery faults,')}<br />{t('让每一步都有据。', 'every step grounded.')}</h1>
        <p className="tractor-hero-description">{t('按机型查阅资料，结合故障现象寻找排查依据。先在模型上认清零件，再去诊断。', 'Find machine-specific documents and evidence for troubleshooting. Learn the parts on the model first, then diagnose.')}</p>
        <div className="tractor-hero-actions">
          <Button size="lg" onPointerEnter={() => preloadPage('/chat')} onFocus={() => preloadPage('/chat')} onClick={() => navigate('/chat')} className="hero-cta-primary gap-3">
            {pick(h.ctaPrimary, lang)}<ArrowRight size={17} />
          </Button>
          <Link className="tractor-hero-text-link" to="/knowledge" onPointerEnter={() => preloadPage('/knowledge')} onFocus={() => preloadPage('/knowledge')}>
            {pick(h.ctaSecondary, lang)}<ArrowRight size={16} />
          </Link>
        </div>
        <div className="tractor-hero-note"><span className="tractor-hero-dot" />{t('以资料适用范围为边界 缺口明确标注', 'Source-aware guidance, visible knowledge gaps')}</div>
        <div className="tractor-hero-model-note">
          <span>{t('柴油部件机 三维结构示意', 'Diesel parts tractor, 3D structure schematic')}</span>
          <Link to="/models" onPointerEnter={() => preloadPage('/models')} onFocus={() => preloadPage('/models')} className="tractor-hero-model-link">
            <span>{t('进入模型工坊', 'Model studio')}</span><ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <div className="tractor-hero-panel">
        <div className="tractor-hero-panel-row">
          <button type="button" className={`tractor-hero-mode${mode === 'orbit' ? ' is-active' : ''}`} onClick={() => setMode('orbit')} aria-pressed={mode === 'orbit'}>
            <RotateCw size={15} />{t('环绕查看', 'Orbit')}
          </button>
          <button type="button" className={`tractor-hero-mode${mode === 'roam' ? ' is-active' : ''}`} onClick={() => setMode('roam')} aria-pressed={mode === 'roam'}>
            <Move3d size={15} />{t('漫游', 'Roam')}
          </button>
          <button type="button" className="tractor-hero-mode" onClick={() => setAutoOrbit(value => !value)} aria-pressed={autoOrbit}>
            {autoOrbit ? <Pause size={15} /> : <Play size={15} />}{t('自动环绕', 'Auto orbit')}
          </button>
          <button type="button" className="tractor-hero-mode" onClick={() => setDof(value => !value)} aria-pressed={dof}>
            <Focus size={15} />{t(dof ? '虚化开' : '虚化关', dof ? 'DOF on' : 'DOF off')}
          </button>
          {mode === 'roam' && (
            <span className="tractor-hero-roam-hint">{t('WASD / 方向键移动，拖动看向，Esc 退出漫游', 'WASD / arrows to move, drag to look, Esc to exit')}</span>
          )}
        </div>

        {selectedPart && (
          <div className="tractor-hero-label-card" role="status">
            <div>
              <strong>{selectedLabel}</strong>
              <span>{lang === 'zh' ? groupInfo(selectedPart.name)?.zh : groupInfo(selectedPart.name)?.en}</span>
            </div>
            <p>{lang === 'zh' ? groupInfo(selectedPart.name)?.descriptionZh : groupInfo(selectedPart.name)?.descriptionEn}</p>
            <button type="button" className="tractor-hero-close" onClick={() => select(null)} aria-label={t('取消选中', 'Clear selection')}><X size={15} /></button>
          </div>
        )}

        <div className="tractor-hero-chips" aria-label={t('零件列表', 'Parts list')}>
          {parts.map(part => (
            <button
              key={part.name}
              type="button"
              className={`tractor-hero-chip${selected === part.name ? ' is-active' : ''}`}
              aria-pressed={selected === part.name}
              onClick={() => select(selected === part.name ? null : part.name)}
            >
              {partChipLabel(part.name, part.labelZh)}
            </button>
          ))}
          {parts.length === 0 && !failed && <span className="tractor-hero-loading">{t('正在加载拖拉机模型…', 'Loading tractor model…')}</span>}
          {failed && <span className="tractor-hero-loading">{t('模型暂不可用，已显示照片画面', 'Model unavailable, photo view shown')}</span>}
        </div>

        {mode === 'roam' && (
          <div className="tractor-hero-pad" aria-label={t('漫游方向', 'Roam controls')}>
            <button type="button" {...roamButton('forward', t('前进', 'Forward'))}>↑</button>
            <button type="button" {...roamButton('left', t('左移', 'Left'))}>←</button>
            <button type="button" {...roamButton('back', t('后退', 'Back'))}>↓</button>
            <button type="button" {...roamButton('right', t('右移', 'Right'))}>→</button>
            <button type="button" {...roamButton('turnLeft', t('向左看', 'Look left'))}>↶</button>
            <button type="button" {...roamButton('turnRight', t('向右看', 'Look right'))}>↷</button>
          </div>
        )}
      </div>
    </section>
  );
}
