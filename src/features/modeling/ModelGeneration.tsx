import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Sparkles } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import type { ModelingCapability, ModelingStatus } from '../../../shared/modeling';

const STORAGE_KEY = 'agridx-img2threejs-job';
async function jsonRequest(path: string, options: RequestInit = {}) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const response = await fetch(`/api/modeling${path}`, { cache: 'no-store', ...options, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : '建模服务暂不可用 / Modeling service unavailable');
  return body;
}
function parseJob(body: unknown): ModelingStatus {
  const value = body as ModelingStatus;
  if (!value || !/^[a-f0-9]{64}$/.test(value.id) || !['queued', 'running', 'succeeded', 'failed'].includes(value.status) || typeof value.message !== 'string') throw new Error('建模服务响应无效 / Invalid modeling response');
  return value;
}
async function prepareImage(url: string): Promise<string> {
  const image = await createImageBitmap(await (await fetch(url)).blob());
  try {
    if (!image.width || !image.height || image.width * image.height > 40_000_000) throw new Error('参考图片像素过大 / Reference image too large');
    const ratio = Math.min(1, 1536 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d'); if (!context) throw new Error('无法处理参考图片 / Image processing unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.9);
    if (result.length > 2 * 1024 * 1024 * 4 / 3) throw new Error('参考图片压缩后仍超过 2 MB / Compressed image exceeds 2 MB');
    return result;
  } finally { image.close(); }
}

export default function ModelGeneration({ photos, identity, onModel, onBusy }: {
  photos: { angle: string; url: string }[];
  identity: string;
  onModel: (file: File) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const lang = useLang(); const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [capability, setCapability] = useState<ModelingCapability | null>(null);
  const [job, setJob] = useState<ModelingStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const modelCallback = useRef(onModel);
  useEffect(() => { modelCallback.current = onModel; }, [onModel]);
  const jobId = job?.id; const jobStatus = job?.status;
  const mounted = useRef(true);
  const busy = submitting || job?.status === 'queued' || job?.status === 'running' || loading;
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const preview = typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__;
    if (preview) setCapability({ available: false, engine: 'img2threejs', message: '独立开发站未连接建模进程，请在配置了服务的正式站使用。' });
    else void jsonRequest('/capabilities', { signal: controller.signal }).then(value => {
      if (mounted.current) setCapability({ available: value?.available === true, engine: 'img2threejs', message: value?.message || 'img2threejs 建模进程尚未配置，请联系管理员。' });
    }).catch(() => { if (mounted.current) setCapability({ available: false, engine: 'img2threejs', message: '暂时无法连接 img2threejs 建模服务。' }); });
    try {
      const id = sessionStorage.getItem(STORAGE_KEY);
      if (!preview && id && /^[a-f0-9]{64}$/.test(id)) void jsonRequest(`/jobs/${id}`, { signal: controller.signal }).then(value => { if (mounted.current) setJob(parseJob(value)); }).catch(() => {});
    } catch { /* Storage is optional. */ }
    return () => { mounted.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (!jobId || !jobStatus || !['queued', 'running'].includes(jobStatus)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = parseJob(await jsonRequest(`/jobs/${jobId}`, { signal: controller.signal })); if (!controller.signal.aborted) { setJob(next); setError(''); } }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法查询任务'); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 3000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [jobId, jobStatus]);
  useEffect(() => {
    if (!jobId || jobStatus !== 'succeeded') return;
    const controller = new AbortController();
    setLoading(true);
    void fetch(`/api/modeling/jobs/${jobId}/model.glb`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('模型下载失败 / Model download failed');
      const file = new File([await response.blob()], 'img2threejs-model.glb', { type: 'model/gltf-binary' });
      if (controller.signal.aborted) return;
      await modelCallback.current(file);
      if (!controller.signal.aborted) setLoaded(true);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '模型预览失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [jobId, jobStatus]);
  async function generate() {
    setSubmitting(true); setError(''); setLoaded(false);
    try {
      const input = { identity, photos: await Promise.all(photos.map(async photo => ({ angle: photo.angle, dataUrl: await prepareImage(photo.url) }))) };
      const next = parseJob(await jsonRequest('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
      if (!mounted.current) return;
      setJob(next); try { sessionStorage.setItem(STORAGE_KEY, next.id); } catch { /* optional */ }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '建模提交失败'); }
    finally { if (mounted.current) setSubmitting(false); }
  }
  return <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/5 p-4 sm:p-5">
    <h3 className="text-sm font-semibold">{t('照片生成 3D · img2threejs', 'Image to 3D · img2threejs')}</h3>
    <p className="mt-2 text-xs leading-6 text-muted-foreground">{t('点击生成后才会上传所选照片。上传前最长边缩放至 1536 像素；照片与结果在建模服务保留最多 24 小时（下次访问清理）。流程包括图片分析、分阶段建模与视觉校验，通常需要数分钟或更久。', 'Selected photos are uploaded only when you generate, resized to a maximum 1536-pixel edge. The worker retains photos and results for up to 24 hours, cleaned on its next request. Analysis, staged modeling and visual review can take several minutes or longer.')}</p>
    <p className="mt-2 text-xs text-muted-foreground" role="status">{capability ? capability.available ? t('建模服务已就绪', 'Modeling service ready') : t(capability.message, 'Modeling worker is unavailable. Ask the administrator to configure it.') : t('正在检查建模服务…', 'Checking modeling service…')}</p>
    <button type="button" disabled={!capability?.available || !photos.length || busy} onClick={generate} style={{ backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)' }} className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40">{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{t(busy ? '建模任务处理中' : '上传并生成 3D 模型', busy ? 'Modeling in progress' : 'Upload and generate 3D')}</button>
    {job && <div className="mt-4 text-xs leading-6" aria-live="polite"><p>{t('任务状态', 'Task status')}：{t(({ queued: '排队中', running: '建模与校验中', succeeded: '生成完成', failed: '未完成' })[job.status], job.status)}</p><p className="text-muted-foreground">{job.message}</p>{loading && <p>{t('正在载入生成模型…', 'Loading generated model…')}</p>}{loaded && <p className="text-primary">{t('生成结果已载入上方预览。', 'The generated model is loaded in the viewer above.')}</p>}</div>}
    {job?.status === 'succeeded' && <div className="mt-3 flex flex-wrap gap-4 text-xs text-primary">{(['model.glb', 'source.ts', 'spec.json', 'review.json'] as const).map(file => <a key={file} href={`/api/modeling/jobs/${job.id}/${file}`} download className="inline-flex items-center gap-1"><Download className="size-3" />{file}</a>)}</div>}
    {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{t('生成结果是参考图的近似重建，隐藏结构和尺寸需要实测核验；可编辑源码随结果保留，GLB 用于网页预览。', 'Results approximate the supplied references. Hidden structures and dimensions require measurement. Editable source is retained; GLB is used for the website preview.')}</p>
  </div>;
}
