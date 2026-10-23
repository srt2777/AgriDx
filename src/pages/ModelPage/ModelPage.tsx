import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Box, Download, ExternalLink, Focus, ImagePlus, Layers3, Upload, X } from 'lucide-react';
import DeferredScene from '@/components/DeferredScene';
import SceneLoading from '@/components/SceneLoading';
import { PREMIUM_MOTION_ENABLED } from '@/components/motion/flag';
import { TwinQuery } from '@/components/motion/ThinkingOrbs';
import { TRACTOR_COMPONENTS, TRACTOR_MODEL_URL, type TractorComponent } from '@/components/tractor-model-info';
import { ModelPeek } from '@/components/CardPeek';
import { useLang } from '@/hooks/useLang';
import { useUiVersion } from '@/hooks/useUiVersion';
import { useUpdateBlocker } from '@/features/updates/useUpdateBlocker';
import ModelGeneration from '@/features/modeling/ModelGeneration';

const TractorViewer = lazy(() => import('@/components/TractorViewer'));
const PartsStudio = lazy(() => import('@/components/parts-tractor/PartsStudio'));

const ANGLES = [
  { id: 'front', zh: '正面', en: 'Front' }, { id: 'left', zh: '左侧', en: 'Left' },
  { id: 'back', zh: '背面', en: 'Back' }, { id: 'right', zh: '右侧', en: 'Right' },
];
type ReferencePhoto = { angle: string; url: string; name: string; size: number };

export default function ModelPage() {
  const lang = useLang();
  const version = useUiVersion();
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [component, setComponent] = useState<TractorComponent>('all');
  const [focusRequest, setFocusRequest] = useState(0);
  const [exploded, setExploded] = useState(false);
  const [photos, setPhotos] = useState<ReferencePhoto[]>([]);
  const [customModel, setCustomModel] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [identity, setIdentity] = useState('');
  const [readingModels, setReadingModels] = useState(0);
  const [generating, setGenerating] = useState(false);
  useUpdateBlocker('/models', generating || readingModels > 0 || !!customModel || photos.length > 0 || !!identity.trim());
  const urls = useRef(new Set<string>());
  const selectedComponent = TRACTOR_COMPONENTS.find(item => item.id === component) ?? TRACTOR_COMPONENTS[0];

  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  function makeUrl(file: File) {
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    return url;
  }
  function removePhoto(angle: string) {
    const old = photos.find(photo => photo.angle === angle);
    if (old) { URL.revokeObjectURL(old.url); urls.current.delete(old.url); }
    setPhotos(previous => previous.filter(photo => photo.angle !== angle));
  }
  function selectPhoto(angle: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError(t('请选择不超过 10 MB 的 JPG、PNG 或 WebP 图片。', 'Choose a JPG, PNG or WebP image up to 10 MB.'));
      return;
    }
    const old = photos.find(photo => photo.angle === angle);
    if (old) { URL.revokeObjectURL(old.url); urls.current.delete(old.url); }
    const photo = { angle, url: makeUrl(file), name: file.name, size: file.size };
    setPhotos(previous => [...previous.filter(photo => photo.angle !== angle), photo]);
    setError('');
  }
  async function selectModel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (file) await loadModel(file).catch(() => {});
  }
  async function loadModel(file: File) {
    setReadingModels(count => count + 1);
    try {
      if (!file.name.toLowerCase().endsWith('.glb') || file.size > 25 * 1024 * 1024 || file.size < 24) throw new Error('format');
      const bytes = await file.arrayBuffer();
      const view = new DataView(bytes);
      if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== file.size || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('format');
      const length = view.getUint32(12, true);
      if (length > file.size - 20) throw new Error('format');
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
      const assets: { uri?: string }[] = [...(json.buffers ?? []), ...(json.images ?? [])];
      if (assets.some(asset => asset.uri && !asset.uri.startsWith('data:'))) throw new Error('external');
      if (customModel) { URL.revokeObjectURL(customModel.url); urls.current.delete(customModel.url); }
      setCustomModel({ url: makeUrl(file), name: file.name });
      setComponent('all'); setExploded(false); setError('');
    } catch (cause) {
      setError(t('请选择完整的 GLB 2.0 文件（最多 25 MB），贴图与资源需内嵌；外部资源文件暂不支持。', 'Use a complete GLB 2.0 file up to 25 MB with embedded resources; external resources are not supported.'));
      throw cause;
    } finally { setReadingModels(count => count - 1); }
  }
  function exportPlan() {
    const plan = { purpose: 'photo-reference-preparation', generatedModel: false, machineIdentity: identity.trim() || '待确认', views: photos.map(({ angle, name, size }) => ({ angle, fileName: name, bytes: size })), generationService: 'img2threejs', submissionStatus: 'reference_checklist_only', nextSteps: ['Run a verified image-to-3D service', 'Review mesh and material in Blender', 'Export embedded GLB and import for preview'] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'agri-model-reference-plan.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={`mx-auto px-4 pb-16 md:px-6 ${version === 'new' ? 'max-w-[1240px] pt-4 md:pt-6' : 'max-w-6xl pt-10 md:pt-16'}`}>
    <div className="mb-8 max-w-3xl">
      <p className="text-xs font-semibold tracking-[.14em] text-primary">{t('耕知 · 模型工坊', 'GENGZHI · MODEL STUDIO')}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground md:text-4xl" data-shared-target={version === 'new' ? 'models' : undefined}>{t('看清结构，再对资料。', 'See the structure, then check the evidence.')}</h1>
      <p className="mt-4 text-sm leading-7 text-muted-foreground">{version === 'new'
        ? t('在柴油拖拉机内部观察发动机联动，结合透视与拆解查看结构；也可切换鸿鹄 T70 电动部件模型。维修结论仍需核对对应机型资料。', 'Inspect the moving engine inside the diesel tractor using x-ray and exploded views, or switch to the electric Honghu T70 parts model. Repair decisions require model-specific evidence.')
        : t('整机和部件都是示意。维修结论仍要回到对应机型的资料。', 'The machine and its parts are a schematic. Repair decisions still follow model-specific evidence.')}</p>
      {version === 'new' && <span className="wheat-line mt-5 w-56" aria-hidden="true" />}
    </div>
    {version === 'new' && !customModel ? <Suspense fallback={PREMIUM_MOTION_ENABLED ? <TwinQuery label={t('正在打开孪生视图…', 'Opening the twin view…')} /> : <SceneLoading />}><PartsStudio onImport={selectModel} /></Suspense> : <div className="grid gap-5 lg:grid-cols-[1.65fr_1fr]">
      <section className="min-w-0 overflow-hidden rounded-3xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium"><Box className="size-4 text-primary" /><span className="truncate">{customModel?.name ?? t('原创拖拉机结构示意', 'Original tractor schematic')}</span></span>
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] text-primary">{customModel ? t('本地预览', 'Local preview') : 'GLB · 0.65 MB'}</span>
        </div>
        <div className="model-stage h-[350px] sm:h-[420px] lg:h-[480px]" data-component={component}><DeferredScene fallback={<SceneLoading />}><TractorViewer controls studio={version === 'new'} modelUrl={customModel?.url ?? TRACTOR_MODEL_URL} component={component} exploded={exploded} onComponentChange={setComponent} focusRequest={focusRequest} /></DeferredScene></div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4 text-xs">
          <a href={TRACTOR_MODEL_URL} download className="flex items-center gap-1.5 font-medium text-primary"><Download className="size-3.5" />{t('下载示意模型', 'Download schematic GLB')}</a>
          <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-primary"><Upload className="size-3.5" />{t('导入 GLB 预览', 'Import GLB')}<input type="file" accept=".glb" className="sr-only" aria-label={t('导入 GLB 模型', 'Import GLB model')} onChange={selectModel} /></label>
          {customModel && <button type="button" className="text-muted-foreground hover:text-primary" onClick={() => { URL.revokeObjectURL(customModel.url); urls.current.delete(customModel.url); setCustomModel(null); setComponent('all'); setExploded(false); }}>{t('恢复示意模型', 'Restore schematic')}</button>}
        </div>
      </section>
      <aside className="min-w-0 rounded-3xl border border-border bg-card p-5 sm:p-6">
        <p className="flex items-center gap-2 text-sm font-semibold"><Layers3 className="size-4 text-primary" />{t('从整机到组件', 'From machine to component')}</p>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">{customModel ? t('本地模型的组件名称与尺寸尚未核验，先查看整体结构。', 'Component names and dimensions of the local model are not verified. Inspect its overall geometry first.') : t('选中组件，观察位置关系；展开示意查看被外壳遮挡的结构。模型没有绑定真实故障或实车尺寸。', 'Select a component or expand the schematic to inspect concealed structures. The model is not bound to real faults or measured dimensions.')}</p>
        {!customModel && <p className="mt-3 text-xs leading-6 text-primary">{t('点击模型或热点选择部件，视角会自动聚焦。拖动旋转，滚动缩放。', 'Click the model or a hotspot to select a component and focus the view. Drag to rotate and scroll to zoom.')}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">{TRACTOR_COMPONENTS.map(item => <button type="button" key={item.id} disabled={!!customModel && item.id !== 'all'} aria-pressed={component === item.id} onClick={() => { setComponent(item.id); if (item.id !== 'all') setFocusRequest(previous => previous + 1); }} className={`model-part min-w-0 break-words rounded-xl border px-3 py-3 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-35 ${component === item.id ? 'is-on border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30'}`}>{t(item.zh, item.en)}{version === 'new' && <ModelPeek id={item.id} caption={t(item.zh, item.en)} />}</button>)}</div>
        <div aria-live="polite" aria-atomic="true" className="mt-4 rounded-xl border border-primary/15 bg-primary/5 p-4">
          <p className="text-xs font-semibold text-foreground">{customModel ? t('本地模型 · 整机', 'Local model · Whole machine') : t(selectedComponent.zh, selectedComponent.en)}</p>
          <p className="mt-2 break-words text-xs leading-6 text-muted-foreground">{customModel ? t('当前导入模型仅支持整机预览。部件分类、热点与聚焦需要先核验模型结构。', 'The imported model supports whole-machine preview. Component selection, hotspots and focus require its structure to be verified first.') : t(selectedComponent.descriptionZh, selectedComponent.descriptionEn)}</p>
        </div>
        <button type="button" disabled={!!customModel || component === 'all'} onClick={() => setFocusRequest(previous => previous + 1)} className="mt-4 flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-3 text-xs font-medium text-primary transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"><Focus className="size-4 shrink-0" /><span>{t('聚焦所选部件', 'Focus selected component')}</span></button>
        <label className="mt-5 flex items-center justify-between rounded-xl border border-border px-3 py-3 text-xs"><span>{t('展开结构示意', 'Expand schematic')}</span><input type="checkbox" checked={exploded} disabled={!!customModel} onChange={event => setExploded(event.target.checked)} className="size-4 accent-green-700" /></label>
        <p className="mt-4 text-[11px] leading-6 text-muted-foreground">{t('结构示意与观察定位不能代替实测 CAD 或机型维修手册。', 'Structural illustrations and viewing positions do not replace measured CAD or model-specific service manuals.')}</p>
        <Link to="/knowledge" className="mt-6 flex items-center justify-between rounded-xl bg-primary px-4 py-3 text-xs font-medium text-primary-foreground">{t('查阅组件的资料与策略', 'Find component evidence')}<ArrowRight className="size-4" /></Link>
      </aside>
    </div>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
    <section className="mt-10 rounded-3xl border border-border bg-card p-5 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">{t('准备多角度照片', 'Prepare reference views')}</h2><p className="mt-2 max-w-2xl text-xs leading-6 text-muted-foreground">{t('使用同一实物、相同光照与完整轮廓的照片。选择照片时仅在当前页面预览；点击下方“上传并生成”后才会发送到建模服务。生成并通过校验的结果会自动载入上方预览。', 'Use the same object, consistent lighting and a complete outline. Selected images remain in this page until you click Upload and generate. Results that pass the pipeline checks load in the viewer above.')}</p></div><span className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">{t('img2threejs · 分阶段建模', 'img2threejs · Staged reconstruction')}</span></div>
      <label className="mt-5 block text-xs text-muted-foreground">{t('参考对象（品牌 / 型号，可选）', 'Reference object (brand / model, optional)')}<input value={identity} onChange={event => setIdentity(event.target.value.slice(0, 120))} className="mt-2 block w-full max-w-sm rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" placeholder={t('如：需建模的拖拉机型号', 'Tractor model to reconstruct')} /></label>
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">{ANGLES.map(angle => {
        const photo = photos.find(item => item.angle === angle.id);
        return <div key={angle.id} className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-background">
          <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 text-xs text-muted-foreground hover:bg-primary/5">
            {photo ? <img src={photo.url} alt={`${t(angle.zh, angle.en)} ${t('参考照片', 'reference photo')}`} className="h-full w-full object-contain" /> : <><ImagePlus className="size-6 text-primary/50" /><span>{t(angle.zh, angle.en)}</span><span className="text-[10px]">{t('选择照片', 'Choose photo')}</span></>}
            <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label={`${t('选择', 'Choose')} ${t(angle.zh, angle.en)} ${t('照片', 'photo')}`} onChange={event => selectPhoto(angle.id, event)} />
          </label>
          {photo && <><span className="block truncate px-3 py-2 text-[10px] text-muted-foreground">{t(angle.zh, angle.en)} · {photo.name}</span><button type="button" onClick={() => removePhoto(angle.id)} aria-label={`${t('移除', 'Remove')} ${t(angle.zh, angle.en)} ${t('照片', 'photo')}`} className="absolute right-2 top-2 rounded-full bg-card/90 p-1.5"><X className="size-3" /></button></>}
        </div>;
      })}</div>
      <div className="mt-5 flex flex-wrap items-center gap-3 text-xs"><button type="button" disabled={!photos.length} onClick={exportPlan} className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-primary-foreground disabled:opacity-40"><Download className="size-3.5" />{t('导出视角清单', 'Export view checklist')}</button><span className="text-muted-foreground">{photos.length} / 4 {t('视角已整理', 'views prepared')}</span></div>
      <ModelGeneration photos={photos} identity={identity} onModel={loadModel} onBusy={setGenerating} />
      <div className="mt-7 grid gap-3 border-t border-border pt-5 text-xs leading-6 md:grid-cols-3">
        <a href="https://github.com/img2threejs/img2threejs" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><span className="flex items-center gap-1.5 font-medium text-foreground">01 · {t('img2threejs 建模流程', 'img2threejs reconstruction')}<ExternalLink className="size-3" /></span>{t('按参考图生成可编辑的 Three.js 代码，并保留分阶段校验记录。', 'Generate editable Three.js code with staged review evidence.')}</a>
        <a href="https://docs.blender.org/manual/en/5.1/addons/import_export/scene_gltf2.html" target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary"><span className="flex items-center gap-1.5 font-medium text-foreground">02 · {t('Blender 修整', 'Refine in Blender')}<ExternalLink className="size-3" /></span>{t('核对网格、材质与尺寸，修整后导出资源内嵌的 GLB。', 'Review geometry, materials and dimensions, then export an embedded GLB.')}</a>
        <div className="text-muted-foreground"><span className="font-medium text-foreground">03 · {t('预览与核验', 'Preview and verify')}</span><p>{t('导入生成结果并检查各个视角。AI 生成几何不能代替实测 CAD，magic 的具体工具仍待确认。', 'Import the result and inspect every view. AI geometry does not replace measured CAD; the specific magic tool remains unconfirmed.')}</p></div>
      </div>
    </section>
  </div>;
}
