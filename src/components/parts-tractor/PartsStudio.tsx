import { useCallback, useState, type ChangeEvent } from 'react';
import { Camera, Download, Upload } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import DeferredScene from '@/components/DeferredScene';
import SceneLoading from '@/components/SceneLoading';
import { modelPreviewFallback } from '@/lib/scene-fallback-copy';
import { publicAsset } from '@/lib/public-asset';
import { probeWebGL } from '@/lib/webgl';
import { useLang } from '@/hooks/useLang';
import { STUDIO_LIGHTS, STUDIO_PRESENTATIONS, type StudioLight, type StudioPresentation } from '@/components/studio-schematic';
import PartsTractorScene from './PartsTractorScene';
import { partTitle, resolveSelection, selectionForPart, type CatalogPart, type PartsModelId } from './parts-catalog';
import { faultList, partExample } from './part-faults';
import { DEFAULT_PARTS_MODEL, orderedParts, PARTS_MODEL_ORDER, PARTS_SHOWCASE } from './parts-models';
import '../tractor-viewer.css';
import './parts-studio.css';

export default function PartsStudio({ onImport }: { onImport: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const lang = useLang();
  const reduced = useReducedMotion() === true;
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [supported] = useState(probeWebGL);
  const [lost, setLost] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  const [light, setLight] = useState<StudioLight>('studio');
  const [presentation, setPresentation] = useState<StudioPresentation>('solid');
  const [faultPartId, setFaultPartId] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState('');
  const [modelId, setModelId] = useState<PartsModelId>(DEFAULT_PARTS_MODEL);
  const spec = PARTS_SHOWCASE[modelId];
  const modelUrl = publicAsset(spec.file);
  const parts = orderedParts(modelId);
  const resolved = resolveSelection(selection, modelId);
  const example = resolved ? partExample(resolved.node.partId, modelId) : null;

  const onReady = useCallback(() => {
    setReady(true);
    setError('');
  }, []);
  const onError = useCallback((message: string) => setError(message), []);
  const onLost = useCallback(() => setLost(true), []);

  function choose(name: string | null) {
    setSelection(name);
  }
  function switchModel(next: PartsModelId) {
    if (next === modelId) return;
    setModelId(next);
    setSelection(null);
    setExplode(0);
    setFaultPartId(null);
    setReady(false);
    setError('');
    setShareNote('');
  }
  function toggleFault(partId: string) {
    const next = faultPartId === partId ? null : partId;
    setFaultPartId(next);
    if (next) setSelection(selectionForPart(next, modelId));
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

  const fallback = modelPreviewFallback(lang === 'zh' ? 'zh' : 'en');
  const graphics = !supported || lost;

  return (
    <div className="parts-studio">
      <section className="parts-stage-card" aria-label={t(spec.titleZh, spec.titleEn)}>
        <div className="parts-stage-head">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{t(spec.titleZh, spec.titleEn)}</span>
            <span className="block text-[11px] text-muted-foreground">{t(spec.summaryZh, spec.summaryEn)}</span>
          </span>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] text-primary">GLB · Meshopt · WebP</span>
        </div>
        <div className="studio-bar">
          <div className="studio-bar-group" role="group" aria-label={t('机型', 'Machine')}>
            {PARTS_MODEL_ORDER.map(id => {
              const item = PARTS_SHOWCASE[id];
              return (
                <button key={id} type="button" className="studio-chip" aria-pressed={modelId === id} onClick={() => switchModel(id)}>{t(item.titleZh, item.titleEn)}</button>
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
          <button type="button" className="studio-save" disabled={!ready || graphics} onClick={() => { void saveIllustration(); }}>
            <Camera size={16} />{t('保存结构示意', 'Save structure illustration')}
          </button>
          <p className="studio-share-note" aria-live="polite">{shareNote}</p>
        </div>
        <div className="model-stage parts-stage" data-model={modelId} data-component={selection ?? 'all'} data-fault={faultPartId ?? ''} data-explode={explode >= 1 ? 'open' : 'closed'}>
          {graphics ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <p className="text-sm font-medium text-foreground">{fallback.title}</p>
              <p className="text-xs">{fallback.note}</p>
              <p className="text-xs">{fallback.hint}</p>
            </div>
          ) : (
            <DeferredScene fallback={<SceneLoading />}>
              <PartsTractorScene
                url={modelUrl}
                selection={selection}
                explode={explode}
                presentation={presentation}
                light={light}
                faultPartId={faultPartId}
                reduced={reduced}
                lang={lang === 'zh' ? 'zh' : 'en'}
                modelId={modelId}
                onSelect={choose}
                onReady={onReady}
                onLost={onLost}
                onError={onError}
              />
            </DeferredScene>
          )}
          {!graphics && !ready && !error && <div className="parts-loading"><span>{t(`正在打开${spec.titleZh}…`, `Opening ${spec.titleEn}…`)}</span></div>}
        </div>
        <div className="parts-explode">
          <label className="sr-only" htmlFor="parts-explode-range">{t('爆炸程度', 'Explode amount')}</label>
          <input id="parts-explode-range" type="range" min={0} max={1} step={0.01} value={explode} onChange={event => setExplode(Number(event.target.value))} />
          <button type="button" aria-pressed={explode >= 1} onClick={() => setExplode(value => value >= 1 ? 0 : 1)}>{t('爆炸展开', 'Explode')}</button>
        </div>
        <div className="parts-stage-foot">
          <a href={modelUrl} download className="inline-flex items-center gap-1.5 font-medium text-primary"><Download className="size-3.5" />{t(modelId === 't70' ? '下载鸿鹄 T70' : '下载部件模型', modelId === 't70' ? 'Download Honghu T70' : 'Download parts model')}</a>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-primary">
            <Upload className="size-3.5" />{t('导入 GLB 预览', 'Import GLB')}
            <input type="file" accept=".glb" className="sr-only" aria-label={t('导入 GLB 模型', 'Import GLB model')} onChange={onImport} />
          </label>
        </div>
      </section>
      <aside className="parts-panel">
        <p>{t('部件', 'Parts')}<span className="parts-chip">{t('示例数据', 'Example data')}</span></p>
        <div className="parts-detail" aria-live="polite">
          {resolved && example ? (
            <>
              <h2>{partTitle(resolved.node, lang === 'zh' ? 'zh' : 'en', modelId)}</h2>
              <p className="parts-status">{t('示例状态', 'Example status')} · {t(example.statusZh, example.statusEn)}</p>
              {example.faults.length > 0 && (
                <>
                  <p className="parts-status">{t('常见故障', 'Common faults')}</p>
                  <ul>{example.faults.map(fault => <li key={fault.zh}>{t(fault.zh, fault.en)}</li>)}</ul>
                </>
              )}
            </>
          ) : <p className="parts-missing">{t('点选模型或列表中的部件。状态和故障是示例，没有接入实车。', 'Select a part in the model or the list. Status and faults are examples, with no live machine attached.')}</p>}
        </div>
        <div className="parts-fault">
          <p>{t('故障示意', 'Fault example')}</p>
          <div className="parts-fault-list" role="group" aria-label={t('带示例故障的部件', 'Parts with example faults')}>
            {faultList(modelId).map(partId => {
              const node = parts.find(part => part.partId === partId);
              if (!node) return null;
              return (
                <button key={partId} type="button" aria-pressed={faultPartId === partId} onClick={() => toggleFault(partId)}>
                  {partTitle(node, lang === 'zh' ? 'zh' : 'en', modelId)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="parts-tree">
          <p>{t('部件树', 'Part tree')}</p>
          <div className="parts-tree-list">
            <button type="button" className="parts-whole" aria-pressed={selection === null} onClick={() => choose(null)}>{t('整机', 'Whole machine')}</button>
            {parts.map(part => <TreeNode key={part.name} part={part} selection={selection} lang={lang === 'zh' ? 'zh' : 'en'} model={modelId} onSelect={choose} />)}
          </div>
        </div>
        {error && <p role="alert" className="parts-missing">{error}</p>}
      </aside>
    </div>
  );
}

function TreeNode({ part, selection, lang, model, onSelect }: { part: CatalogPart; selection: string | null; lang: 'zh' | 'en'; model: PartsModelId; onSelect: (name: string) => void }) {
  const [opened, setOpened] = useState(false);
  if (!part.group) {
    return (
      <button type="button" aria-pressed={selection === part.name} onClick={() => onSelect(part.name)}>
        {partTitle(part, lang, model)}
      </button>
    );
  }
  const open = opened || selection === `group:${part.name}` || part.children.some(child => child.name === selection);
  return (
    <div className="parts-group">
      <button type="button" aria-expanded={open} aria-pressed={selection === `group:${part.name}`} onClick={() => { setOpened(true); onSelect(`group:${part.name}`); }}>
        {partTitle(part, lang, model)}
      </button>
      {open && (
        <div className="parts-fault-list">
          {part.children.map(child => (
            <button key={child.name} type="button" aria-pressed={selection === child.name} onClick={() => onSelect(child.name)}>
              {partTitle(child, lang, model)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
