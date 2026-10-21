import { useLang } from '@/hooks/useLang';
import { useUiVersion } from '@/hooks/useUiVersion';

export default function PageLoading() {
  const lang = useLang();
  const version = useUiVersion();
  const label = lang === 'zh' ? '页面加载中…' : 'Loading page…';
  if (version === 'new') {
    return <div className="nv-skeleton" role="status" aria-live="polite">
      <p>{label}</p>
      <div className="nv-skeleton-block" aria-hidden="true"><span /><span /><span /></div>
      <div className="nv-skeleton-grid" aria-hidden="true"><i /><i /><i /></div>
    </div>;
  }
  return <div className="mx-auto w-full max-w-6xl px-5 py-10" role="status" aria-live="polite">
    <p className="text-sm text-muted-foreground">{label}</p>
    <div className="mt-6 h-8 w-2/3 rounded-lg bg-muted" aria-hidden="true" />
    <div className="mt-4 h-4 w-1/2 rounded-lg bg-muted" aria-hidden="true" />
    <div className="mt-8 h-48 rounded-2xl bg-muted" aria-hidden="true" />
  </div>;
}
