import { lazy, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import DeferredScene from '@/components/DeferredScene';
import PartsPreviewFallback from '@/components/parts-tractor/PartsPreviewFallback';
import { PARTS_SHOWCASE } from '@/components/parts-tractor/parts-models';
import { publicAsset } from '@/lib/public-asset';
import { probeWebGL } from '@/lib/webgl';
const Scene = lazy(() => import('@/components/parts-tractor/PartsTractorScene'));

export default function FaultModel({ selection, onSelect, reduced, zh, isolate }: {
  selection: string | null; onSelect: (value: string) => void; reduced: boolean; zh: boolean; isolate: boolean;
}) {
  const [error, setError] = useState<'unsupported' | 'lost' | 'error' | null>(() => probeWebGL() ? null : 'unsupported');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = () => { setReady(false); setError(probeWebGL() ? null : 'unsupported'); setAttempt(n => n + 1); };
  const fallback = <PartsPreviewFallback modelId="diesel" exploded={false} reason={error ?? 'error'} onRetry={retry} />;
  return <div className="fault-model-stage">
    {error ? fallback : <ErrorBoundary key={attempt} fallback={fallback} onError={() => setError('error')}>
      <DeferredScene priority fallback={<p role="status">{zh ? '加载结构示意…' : 'Loading schematic…'}</p>}>
        <Scene url={publicAsset(PARTS_SHOWCASE.diesel.file)} selection={selection} explode={0}
          presentation={isolate ? 'isolate' : 'solid'} light="studio" faultPartId={null} reduced={reduced}
          lang={zh ? 'zh' : 'en'} modelId="diesel" onSelect={onSelect} onReady={() => setReady(true)}
          onLost={() => setError('lost')} onError={() => setError('error')} />
      </DeferredScene>
    </ErrorBoundary>}
    {!ready && !error && <span className="fault-model-loading" role="status">{zh ? '正在载入柴油结构模型…' : 'Loading diesel model…'}</span>}
  </div>;
}
