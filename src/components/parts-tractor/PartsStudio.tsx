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
import { catalogParts, partTitle, resolveSelection, selectionForPart, type CatalogPart } from './parts-catalog';
import { faultList, partExample } from './part-faults';
import '../tractor-viewer.css';
import './parts-studio.css';

const MODEL_URL = publicAsset('models/tractor-parts/tractor_parts.glb');

export default function PartsStudio({ onImport }: { onImport: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const lang = useLang();
  const reduced = useReducedMotion() === true;
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [supported] = useState(probeWebGL);
  const [lost, setLost] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [meshNames, setMeshNames] = useState<ReadonlySet<string>>(() => new Set());
  const [selection, setSelection] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  const [light, setLight] = useState<StudioLight>('studio');
  const [presentation, setPresentation] = useState<StudioPresentation>('solid');
  const [faultPartId, setFaultPartId] = useState<string | null>(null);
  const [shareNote, setShareNote] = useState('');
  const parts = catalogParts();
  const resolved = resolveSelection(selection);
  const example = resolved ? partExample(resolved.node.partId) : null;
  const meshReady = hasMesh(resolved?.node ?? null, meshNames);

  const onReady = useCallback((names: string[]) => {
    setMeshNames(new Set(names));
    setReady(true);
    setError('');
  }, []);
  const onError = useCallback((message: string) => setError(message), []);
  const onLost = useCallback(() => setLost(true), []);

  function choose(name: string | null) {
    setSelection(name);
  }
  function toggleFault(partId: string) {
    const next = faultPartId === partId ? null : partId;
    setFaultPartId(next);
    if (next) setSelection(selectionForPart(next));
  }
  async function saveIllustration() {
    const canvas = document.querySelector<HTMLCanvasElement>('.parts-stage canvas');
    if (!canvas) return;
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agridx-parts-tractor.png';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setShareNote(t('已保存结构示意', 'Structure illustration saved'));
  }

  const fallback = modelPreviewFallback(lang === 'zh' ? 'zh' : 'en');
  const graphics = !supported || lost;

  return (
    <div className="parts-studio">
      <section className="parts-stage-card" aria-label={t('部件拖拉机', 'Parts tractor')}>
        <div className="parts-stage-head">
          <span className="text-sm font-medium">{t('部件拖拉机', 'Parts tractor')}</span>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] text-primary">GLB · Meshopt · WebP</span>
        </div>
        <div className="studio-bar">
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
        <div className="model-stage parts-stage" data-component={selection ?? 'all'} data-fault={faultPartId ?? ''} data-explode={explode >= 1 ? 'open' : 'closed'}>
          {graphics ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <p className="text-sm font-medium text-foreground">{fallback.title}</p>
              <p className="text-xs">{fallback.note}</p>
              <p className="text-xs">{fallback.hint}</p>
            </div>
          ) : (
            <DeferredScene fallback={<SceneLoading />}>
              <PartsTractorScene
                url={MODEL_URL}
                selection={selection}
                explode={explode}
                presentation={presentation}
                light={light}
                faultPartId={faultPartId}
                reduced={reduced}
                lang={lang === 'zh' ? 'zh' : 'en'}
                onSelect={choose}
                onReady={onReady}
                onLost={onLost}
                onError={onError}
              />
            </DeferredScene>
          )}
          {!graphics && !ready && !error && <div className="parts-loading"><span>{t('正在打开部件模型…', 'Opening the parts model…')}</span></div>}
        </div>
        <div className="parts-explode">
          <label className="sr-only" htmlFor="parts-explode-range">{t('爆炸程度', 'Explode amount')}</label>
          <input id="parts-explode-range" type="range" min={0} max={1} step={0.01} value={explode} onChange={event => setExplode(Number(event.target.value))} />
          <button type="button" aria-pressed={explode >= 1} onClick={() => setExplode(value => value >= 1 ? 0 : 1)}>{t('爆炸展开', 'Explode')}</button>
        </div>
        <div className="parts-stage-foot">
          <a href={MODEL_URL} download className="inline-flex items-center gap-1.5 font-medium text-primary"><Download className="size-3.5" />{t('下载部件模型', 'Download parts model')}</a>
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
              <h2>{partTitle(resolved.node, lang === 'zh' ? 'zh' : 'en')}</h2>
              <p className="parts-status">{t('示例状态', 'Example status')} · {t(example.statusZh, example.statusEn)}</p>
              {example.faults.length > 0 && (
                <>
                  <p className="parts-status">{t('常见故障', 'Common faults')}</p>
                  <ul>{example.faults.map(fault => <li key={fault.zh}>{t(fault.zh, fault.en)}</li>)}</ul>
                </>
              )}
              {!meshReady && ready && <p className="parts-missing">{t('当前模型文件里没有这个网格，说明仍来自部件表。', 'This mesh is not in the current file. The note still comes from the parts list.')}</p>}
            </>
          ) : <p className="parts-missing">{t('点选模型或列表中的部件。状态和故障是示例，没有接入实车。', 'Select a part in the model or the list. Status and faults are examples, with no live machine attached.')}</p>}
        </div>
        <div className="parts-fault">
          <p>{t('故障示意', 'Fault example')}</p>
          <div className="parts-fault-list" role="group" aria-label={t('带示例故障的部件', 'Parts with example faults')}>
            {faultList().map(partId => {
              const node = parts.find(part => part.partId === partId);
              if (!node) return null;
              return (
                <button key={partId} type="button" aria-pressed={faultPartId === partId} onClick={() => toggleFault(partId)}>
                  {partTitle(node, lang === 'zh' ? 'zh' : 'en')}
                </button>
              );
            })}
          </div>
        </div>
        <div className="parts-tree">
          <p>{t('部件树', 'Part tree')}</p>
          <div className="parts-tree-list">
            <button type="button" className="parts-whole" aria-pressed={selection === null} onClick={() => choose(null)}>{t('整机', 'Whole machine')}</button>
            {parts.map(part => <TreeNode key={part.name} part={part} selection={selection} lang={lang === 'zh' ? 'zh' : 'en'} onSelect={choose} />)}
          </div>
        </div>
        {error && <p role="alert" className="parts-missing">{error}</p>}
      </aside>
    </div>
  );
}

function hasMesh(node: CatalogPart | null, names: ReadonlySet<string>) {
  if (!node) return false;
  if (node.group) return node.children.some(child => names.has(child.name));
  return names.has(node.name);
}

function TreeNode({ part, selection, lang, onSelect }: { part: CatalogPart; selection: string | null; lang: 'zh' | 'en'; onSelect: (name: string) => void }) {
  const [opened, setOpened] = useState(false);
  if (!part.group) {
    return (
      <button type="button" aria-pressed={selection === part.name} onClick={() => onSelect(part.name)}>
        {partTitle(part, lang)}
      </button>
    );
  }
  const open = opened || selection === `group:${part.name}` || part.children.some(child => child.name === selection);
  return (
    <div className="parts-group">
      <button type="button" aria-expanded={open} aria-pressed={selection === `group:${part.name}`} onClick={() => { setOpened(true); onSelect(`group:${part.name}`); }}>
        {partTitle(part, lang)}
      </button>
      {open && (
        <div className="parts-fault-list">
          {part.children.map(child => (
            <button key={child.name} type="button" aria-pressed={selection === child.name} onClick={() => onSelect(child.name)}>
              {partTitle(child, lang)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
