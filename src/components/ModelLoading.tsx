import { useLang } from '@/hooks/useLang';

export default function ModelLoading() {
  const lang = useLang();
  return <div className="nv-model-skeleton" role="status" aria-live="polite">
    <p>{lang === 'zh' ? '正在准备模型与部件视图…' : 'Preparing the model and parts view…'}</p>
    <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
  </div>;
}
