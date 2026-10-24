import { useCallback, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Camera, Download, Upload, X } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import DeferredScene from '@/components/DeferredScene';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';
import { BorderBeam } from '@/components/motion/BorderBeam';
import { MorphingPanel } from '@/components/motion/MorphingPanel';
import { TiltCard } from '@/components/motion/TiltCard';
import { TwinQuery } from '@/components/motion/ThinkingOrbs';
import PartsPreviewFallback from './PartsPreviewFallback';
import PartKnowledge from './PartKnowledge';
import { publicAsset } from '@/lib/public-asset';
import { probeWebGL } from '@/lib/webgl';
import { useLang } from '@/hooks/useLang';
import { useIsMobile } from '@/hooks/use-mobile';
import { partListIndex, partOutlines, restorePartFocus } from './parts-interaction';
import { STUDIO_LIGHTS, STUDIO_PRESENTATIONS, type StudioLight, type StudioPresentation } from '@/components/studio-schematic';
import PartsTractorScene from './PartsTractorScene';
import { partTitle, resolveSelection, selectionForPart, type CatalogPart, type PartsModelId } from './parts-catalog';
import { faultList, partExample } from './part-faults';
import { DEFAULT_PARTS_MODEL, orderedParts, PARTS_MODEL_ORDER, PARTS_SHOWCASE } from './parts-models';
import '../tractor-viewer.css';
import './parts-studio.css';

type StudioLog = { id: number; zh: string; en: string };

export default function PartsStudio({ onImport }: { onImport: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const lang = useLang();
  const reduced = useReducedMotion() === true;
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [supported, setSupported] = useState(probeWebGL);
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const [lost, setLost] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const mobile = useIsMobile();
  const [coarse] = useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  const [outlineChoice, setOutlineChoice] = useState<boolean | null>(null);
  const outline = partOutlines(mobile, coarse, outlineChoice);
  const [listOnly, setListOnly] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listId = useId();
  const [explode, setExplode] = useState(0);
  const [engineRunning, setEngineRunning] = useState(false);
  const [engineSpeed, setEngineSpeed] = useState(2);
  const [light, setLight] = useState<StudioLight>('studio');
  const [presentation, setPresentation] = useState<StudioPresentation>('solid');
  const [faultPartId, setFaultPartId] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState('');
  const [modelId, setModelId] = useState<PartsModelId>(DEFAULT_PARTS_MODEL);
  const [detailStep, setDetailStep] = useState<'overview' | 'faults' | 'log'>('overview');
  const [log, setLog] = useState<StudioLog[]>([
    { id: 2, zh: '工坊就绪 · 鸿鹄 T70', en: 'Studio ready · Honghu T70' },
    { id: 1, zh: '结构示意 · 未接实车', en: 'Schematic · no live machine' },
  ]);
  const spec = PARTS_SHOWCASE[modelId];
  const modelUrl = publicAsset(spec.file);
  const parts = orderedParts(modelId);
  const resolved = resolveSelection(selection, modelId);
  const example = resolved ? partExample(resolved.node.partId, modelId) : null;
  const language = lang === 'zh' ? 'zh' : 'en';
  const faultNode = faultPartId ? parts.find(part => part.partId === faultPartId) : undefined;
  const faultLabel = faultNode ? partTitle(faultNode, language, modelId) : t('未点亮', 'Off');

  const pushLog = useCallback((zh: string, en: string) => {
    setLog(previous => (previous[0]?.zh === zh ? previous : [{ id: (previous[0]?.id ?? 0) + 1, zh, en }, ...previous].slice(0, 4)));
  }, []);

  const onReady = useCallback(() => {
    setReady(true);
    setError('');
  }, []);
  const onError = useCallback((message: string) => setError(message), []);
  const onLost = useCallback(() => setLost(true), []);

  function choose(name: string | null, fromCanvas = false) {
    if (name) {
      returnFocus.current = !fromCanvas && panelRef.current?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
      setFocusRequest(value => value + 1);
    }
    setSelection(name);
    setDetailStep('overview');
    if (!name) return;
    const next = resolveSelection(name, modelId);
    if (!next) return;
    const title = partTitle(next.node, language, modelId);
    pushLog(`点选 · ${title}`, `Selected · ${partTitle(next.node, 'en', modelId)}`);
  }
  function selectedListButton(name = selection ?? '') {
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-selection]') ?? []);
    return buttons.find(button => button.dataset.selection === name) ?? buttons[0] ?? null;
  }
  function showParts() {
    const button = selectedListButton();
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'nearest' });
  }
  function closeDetails() {
    const fallback = selectedListButton(resolved?.parent ? `group:${resolved.parent.name}` : selection ?? '');
    const preferred = returnFocus.current;
    choose(null);
    window.requestAnimationFrame(() => restorePartFocus(preferred, fallback));
  }
  function navigateParts(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')).filter(button => !button.disabled);
    const index = partListIndex(buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length, event.key);
    if (index === null) return;
    event.preventDefault();
    buttons[index]?.focus();
  }
  function switchModel(next: PartsModelId) {
    if (next === modelId) return;
    const item = PARTS_SHOWCASE[next];
    setModelId(next);
    setSelection(null);
    setDetailStep('overview');
    setExplode(0);
    setFaultPartId(null);
    setReady(false);
    setError('');
    setShareNote('');
    setEngineRunning(false);
    pushLog(`切换机型 · ${item.titleZh}`, `Model · ${item.titleEn}`);
  }
  function toggleEngineMotion() {
    if (modelId === 'diesel' && engineRunning) { setEngineRunning(false); return; }
    if (modelId !== 'diesel') switchModel('diesel');
    setSelection(null);
    setPresentation('xray');
    setEngineRunning(true);
  }
  function toggleFault(partId: string) {
    const next = faultPartId === partId ? null : partId;
    setFaultPartId(next);
    if (!next) {
      pushLog('故障示意已关闭', 'Fault example cleared');
      return;
    }
    setSelection(selectionForPart(next, modelId));
    returnFocus.current = panelRef.current?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    setFocusRequest(value => value + 1);
    const node = parts.find(part => part.partId === next);
    const title = node ? partTitle(node, language, modelId) : next;
    const titleEn = node ? partTitle(node, 'en', modelId) : next;
    pushLog(`故障示意 · ${title}`, `Fault example · ${titleEn}`);
  }
  function toggleExplode() {
    const open = explode < 1;
    setExplode(open ? 1 : 0);
    pushLog(open ? '爆炸展开 · 100%' : '爆炸收回 · 整机', open ? 'Exploded · 100%' : 'Explosion closed');
  }
  async function saveIllustration() {
    const canvas = document.querySelector<HTMLCanvasElement>('.parts-stage canvas');
    if (!canvas) return;
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = spec.shotName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setShareNote(t('已保存结构示意', 'Structure illustration saved'));
  }

  const graphics = !supported || lost || !!error;
  const staticView = graphics || listOnly;
  function retryGraphics() {
    setListOnly(false);
    setReady(false);
    setError('');
    setLost(false);
    setSupported(probeWebGL());
    setSceneAttempt(value => value + 1);
  }

  const selectedLabel = resolved ? partTitle(resolved.node, language, modelId) : t('整机', 'Whole machine');
  const timeline = [...log].reverse();

  return (
    <div className={`parts-studio${resolved ? ' is-part-open' : ''}${reduced ? ' is-reduced' : ''}${staticView ? ' is-list-view' : ''}`} onKeyDown={event => {
      if (event.key === 'Escape' && resolved && !['INPUT', 'SELECT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) {
        event.stopPropagation(); closeDetails();
      }
    }}>
      <section className="parts-stage-card" aria-label={t(spec.titleZh, spec.titleEn)}>
        <div className="parts-stage-head">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t(spec.titleZh, spec.titleEn)}</span>
            <span className="block text-[11px] text-muted-foreground">{t(spec.summaryZh, spec.summaryEn)}</span>
            <span className="block text-[11px] text-muted-foreground">{t('结构示意，不代表实车 CAD', 'Structural schematic, not actual vehicle CAD')}</span>
          </span>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] text-primary">GLB · Meshopt · WebP</span>
        </div>
        <div className="studio-bar">
          <div className="studio-bar-group" role="group" aria-label={t('机型', 'Machine')}>
            {PARTS_MODEL_ORDER.map(id => {
              const item = PARTS_SHOWCASE[id];
              const selectedModel = modelId === id;
              return (
                <TiltCard key={id} className="studio-tilt">
                  <button type="button" className={`studio-chip${selectedModel && PREMIUM_MOTION_ENABLED ? ' is-beamed' : ''}`} aria-pressed={selectedModel} onClick={() => switchModel(id)}>
                    {selectedModel && PREMIUM_MOTION_ENABLED && <BorderBeam />}
                    {t(item.titleZh, item.titleEn)}
                  </button>
                </TiltCard>
              );
            })}
          </div>
          <div className="studio-bar-group" role="group" aria-label={t('棚拍灯光', 'Studio lighting')}>
            {STUDIO_LIGHTS.map(item => (
              <button key={item.id} type="button" className="studio-chip" aria-pressed={light === item.id} onClick={() => setLight(item.id)}>{t(item.zh, item.en)}</button>
            ))}
          </div>
          <div className="studio-bar-group" role="group" aria-label={t('部件显示', 'Part display')}>
            {STUDIO_PRESENTATIONS.map(item => (
              <button key={item.id} type="button" className="studio-chip" aria-pressed={presentation === item.id} onClick={() => setPresentation(item.id)}>{t(item.zh, item.en)}</button>
            ))}
          </div>
          <button type="button" className="studio-chip" disabled={staticView} aria-pressed={outline} onClick={() => setOutlineChoice(!outline)}>{t('选中描边', 'Selection outline')}</button>
          <button type="button" className="studio-chip" disabled={staticView || !ready || !resolved} onClick={() => setFocusRequest(value => value + 1)}>{t('聚焦选中', 'Focus selection')}</button>
          <button type="button" className="studio-chip" aria-pressed={staticView} disabled={graphics} onClick={() => { setListOnly(value => !value); setEngineRunning(false); setReady(false); }}>{t('二维部件列表', '2D parts list')}</button>
          <button type="button" className="studio-chip" disabled={reduced || staticView} aria-pressed={modelId === 'diesel' && engineRunning} onClick={toggleEngineMotion}>{modelId === 'diesel' && engineRunning ? t('暂停发动机', 'Pause engine') : t('发动机联动', 'Engine motion')}</button>
          {modelId === 'diesel' && <label className="studio-bar-group text-xs">{t('发动机转速', 'Engine speed')}<select aria-label={t('发动机转速', 'Engine speed')} value={engineSpeed} onChange={event => setEngineSpeed(Number(event.target.value))} className="studio-chip"><option value={1}>0.5×</option><option value={2}>1×</option><option value={4}>2×</option></select></label>}
          <button type="button" className={PREMIUM_MOTION_ENABLED ? 'studio-save glass-press' : 'studio-save'} data-motion={PREMIUM_MOTION_ENABLED ? 'glass-press' : undefined} disabled={!ready || staticView} onClick={() => { void saveIllustration(); }}>
            <Camera size={16} />{t('保存结构示意', 'Save structure illustration')}
          </button>
          <p className="studio-share-note" aria-live="polite">{shareNote}</p>
        </div>
        <div className="model-stage parts-stage" data-model={modelId} data-outline={outline ? 'on' : 'off'} data-engine={modelId === 'diesel' && engineRunning && !reduced && !staticView ? 'running' : 'paused'} data-component={selection ?? 'all'} data-fault={faultPartId ?? ''} data-explode={explode >= 1 ? 'open' : 'closed'}>
          <div className="parts-viewport" tabIndex={staticView ? -1 : 0} role="group" aria-label={t('结构示意视图；可用二维列表选择部件', 'Structure view; use the 2D list to select parts')} onPointerDownCapture={event => {
            if ((event.target as HTMLElement).tagName === 'CANVAS') event.currentTarget.focus({ preventScroll: true });
          }}>
            <div className="parts-kpi" aria-label={t('示例概览', 'Example overview')}>
              <TiltCard className="parts-kpi-card"><span className="parts-chip">{t('示例数据', 'Example data')}</span></TiltCard>
              <TiltCard className="parts-kpi-card"><span><b>{parts.length}</b> {t('部件', 'Parts')}</span></TiltCard>
              <TiltCard className="parts-kpi-card"><span><b>{selectedLabel}</b> {t('选中', 'Selected')}</span></TiltCard>
              <TiltCard className="parts-kpi-card"><span><b>{Math.round(explode * 100)}%</b> {t('爆炸', 'Explode')}</span></TiltCard>
              <TiltCard className="parts-kpi-card"><span><b>{faultLabel}</b> {t('故障', 'Fault')}</span></TiltCard>
            </div>
            {staticView ? (
              <PartsPreviewFallback modelId={modelId} exploded={explode >= 1} reason={graphics ? lost ? 'lost' : error ? 'error' : 'unsupported' : 'manual'} onRetry={retryGraphics} onShowParts={showParts} />
            ) : (
              <ErrorBoundary key={sceneAttempt} fallback={<PartsPreviewFallback modelId={modelId} exploded={explode >= 1} reason="error" onRetry={retryGraphics} onShowParts={showParts} />} onError={error => onError(error instanceof Error ? error.message : String(error))}>
              <DeferredScene fallback={PREMIUM_MOTION_ENABLED ? <TwinQuery label={t('正在打开孪生视图…', 'Opening the twin view…')} /> : <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground" role="status"><span>{t('正在打开孪生视图…', 'Opening the twin view…')}</span></div>}>
                <PartsTractorScene
                  key={sceneAttempt}
                  url={modelUrl}
                  selection={selection}
                  focusRequest={focusRequest}
                  outline={outline}
                  explode={explode}
                  engineRunning={engineRunning && modelId === 'diesel'}
                  engineSpeed={engineSpeed}
                  presentation={presentation}
                  light={light}
                  faultPartId={faultPartId}
                  reduced={reduced}
                  lang={lang === 'zh' ? 'zh' : 'en'}
                  modelId={modelId}
                  onSelect={name => choose(name, true)}
                  onClear={() => choose(null)}
                  onReady={onReady}
                  onLost={onLost}
                  onError={onError}
                />
              </DeferredScene>
              </ErrorBoundary>
            )}
            {!staticView && !ready && !error && <div className="parts-loading">{PREMIUM_MOTION_ENABLED ? <TwinQuery label={t(`正在打开${spec.titleZh}…`, `Opening ${spec.titleEn}…`)} /> : <span>{t(`正在打开${spec.titleZh}…`, `Opening ${spec.titleEn}…`)}</span>}</div>}
            <ol className="parts-event-log" aria-label={t('示例记录', 'Example log')}>
              {timeline.map(item => <li key={item.id}>{language === 'zh' ? item.zh : item.en}</li>)}
            </ol>
          </div>
          <aside className="parts-panel" ref={panelRef}>
            <p>{t('部件', 'Parts')}<span className="parts-chip">{t('示例数据', 'Example data')}</span></p>
            <p className="parts-panel-note">{staticView ? t('从列表选择部件，下方查看详情与知识目录。状态和故障是示例，没有接入实车。', 'Select a part from the list to see details and source links below. Status and faults are examples, with no live machine attached.') : t('点选部件后查看详情。状态和故障是示例，没有接入实车。', 'Select a part to view details. Status and faults are examples, with no live machine attached.')}</p>
            <div className="parts-fault">
              <p>{t('故障示意', 'Fault example')}</p>
              <div className="parts-fault-list" role="group" aria-label={t('带示例故障的部件', 'Parts with example faults')}>
                {faultList(modelId).map(partId => {
                  const node = parts.find(part => part.partId === partId);
                  if (!node) return null;
                  return (
                    <button key={partId} type="button" aria-pressed={faultPartId === partId} onClick={() => toggleFault(partId)}>
                      {partTitle(node, language, modelId)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="parts-tree">
              <p id={listId}>{t('二维部件列表', '2D parts list')}</p>
              <p className="parts-panel-note">{t('方向键移动，回车或空格选择；Esc 关闭详情。', 'Arrow keys move; Enter or Space selects; Esc closes details.')}</p>
              <div className="parts-tree-list" role="group" aria-labelledby={listId} ref={listRef} onKeyDown={navigateParts}>
                <button type="button" className="parts-whole" data-selection="" aria-pressed={selection === null} onClick={() => choose(null)}>{t('整机', 'Whole machine')}</button>
                {parts.map(part => <TreeNode key={part.name} part={part} selection={selection} lang={language} model={modelId} onSelect={choose} />)}
              </div>
            </div>
            {error && <p role="alert" className="parts-missing">{error}</p>}
          </aside>
          <aside className="parts-drawer" aria-live="polite" aria-hidden={resolved ? undefined : true} inert={resolved ? undefined : true}>
            <div className="parts-drawer-head">
              <p>{t('部件详情', 'Part detail')}<span className="parts-chip">{t('示例数据', 'Example data')}</span></p>
              <button type="button" className="parts-drawer-close" onClick={closeDetails} aria-label={t('关闭部件详情', 'Close part detail')}><X size={16} /></button>
            </div>
            {resolved && example && (PREMIUM_MOTION_ENABLED ? (
              <>
                <div className="morph-steps" role="tablist" aria-label={t('部件详情步骤', 'Part detail steps')}>
                  {([
                    ['overview', t('概况', 'Overview')],
                    ['faults', t('故障', 'Faults')],
                    ['log', t('记录', 'Log')],
                  ] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={detailStep === id} onClick={() => setDetailStep(id)}>{label}</button>
                  ))}
                </div>
                <MorphingPanel stepKey={`${resolved.node.name}:${detailStep}`} className="parts-morph is-beamed" beam>
                  {detailStep === 'overview' && (
                    <div className="parts-detail">
                      <h2>{partTitle(resolved.node, language, modelId)}</h2>
                      <p className="parts-status">{t('示例状态', 'Example status')} · {t(example.statusZh, example.statusEn)}</p>
                    </div>
                  )}
                  {detailStep === 'faults' && (
                    <div className="parts-detail">
                      <h2>{t('常见故障', 'Common faults')}</h2>
                      {example.faults.length > 0
                        ? <ul>{example.faults.map(fault => <li key={fault.zh}>{t(fault.zh, fault.en)}</li>)}</ul>
                        : <p className="parts-status">{t('这一部件没有示例故障。', 'This part has no example fault.')}</p>}
                    </div>
                  )}
                  {detailStep === 'log' && (
                    <div className="parts-detail">
                      <h2>{t('示例记录', 'Example log')}</h2>
                      <ul>{log.slice(0, 3).map(item => <li key={item.id}>{language === 'zh' ? item.zh : item.en}</li>)}</ul>
                    </div>
                  )}
                </MorphingPanel>
              </>
            ) : (
              <div className="parts-detail">
                <h2>{partTitle(resolved.node, language, modelId)}</h2>
                <p className="parts-status">{t('示例状态', 'Example status')} · {t(example.statusZh, example.statusEn)}</p>
                {example.faults.length > 0 && <ul>{example.faults.map(fault => <li key={fault.zh}>{t(fault.zh, fault.en)}</li>)}</ul>}
              </div>
            ))}
            {resolved && <PartKnowledge key={modelId} modelId={modelId} partId={resolved.node.partId} lang={language} />}
          </aside>
        </div>
        <div className="parts-explode">
          <label className="sr-only" htmlFor="parts-explode-range">{t('爆炸程度', 'Explode amount')}</label>
          <input id="parts-explode-range" type="range" min={0} max={1} step={0.01} value={explode} onChange={event => setExplode(Number(event.target.value))} />
          <button type="button" aria-pressed={explode >= 1} onClick={toggleExplode}>{t('爆炸展开', 'Explode')}</button>
        </div>
        <div className="parts-stage-foot">
          <a href={modelUrl} download className="inline-flex items-center gap-1.5 font-medium text-primary"><Download className="size-3.5" />{t(modelId === 't70' ? '下载鸿鹄 T70' : '下载部件模型', modelId === 't70' ? 'Download Honghu T70' : 'Download parts model')}</a>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-primary">
            <Upload className="size-3.5" />{t('导入 GLB 预览', 'Import GLB')}
            <input type="file" accept=".glb" className="sr-only" aria-label={t('导入 GLB 模型', 'Import GLB model')} onChange={onImport} />
          </label>
        </div>
      </section>
    </div>
  );
}

function TreeNode({ part, selection, lang, model, onSelect }: { part: CatalogPart; selection: string | null; lang: 'zh' | 'en'; model: PartsModelId; onSelect: (name: string) => void }) {
  const [opened, setOpened] = useState(false);
  if (!part.group) {
    return (
      <button type="button" data-selection={part.name} aria-pressed={selection === part.name} onClick={() => onSelect(part.name)}>
        {partTitle(part, lang, model)}
      </button>
    );
  }
  const open = opened || selection === `group:${part.name}` || part.children.some(child => child.name === selection);
  return (
    <div className="parts-group">
      <button type="button" data-selection={`group:${part.name}`} aria-expanded={open} aria-pressed={selection === `group:${part.name}`} onClick={() => { setOpened(true); onSelect(`group:${part.name}`); }}>
        {partTitle(part, lang, model)}
      </button>
      {open && (
        <div className="parts-fault-list">
          {part.children.map(child => (
            <button key={child.name} type="button" data-selection={child.name} aria-pressed={selection === child.name} onClick={() => onSelect(child.name)}>
              {partTitle(child, lang, model)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
