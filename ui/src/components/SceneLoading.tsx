import { Loader2 } from 'lucide-react';
import { useLang } from '@/hooks/useLang';

export default function SceneLoading() {
  const lang = useLang();
  return <div className="flex h-full w-full items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
    <Loader2 size={18} className="motion-safe:animate-spin" />
    <span>{lang === 'zh' ? '三维视图加载中…' : 'Loading 3D view…'}</span>
  </div>;
}
