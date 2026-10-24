import { useLang } from '@/hooks/useLang';
import { publicAsset } from '@/lib/public-asset';
import type { PartsModelId } from './parts-catalog';

/** Keep the workshop useful without a graphics context; never label a static drawing as live 3D. */
export default function PartsPreviewFallback({ modelId, exploded, reason, onRetry, onShowParts }: {
  modelId: PartsModelId;
  exploded: boolean;
  reason: 'unsupported' | 'lost' | 'error' | 'manual';
  onRetry: () => void;
  onShowParts?: () => void;
}) {
  const lang = useLang();
  const zh = lang === 'zh';
  return (
    <div className="parts-preview-fallback" data-graphics={reason}>
      {modelId === 't70' ? (
        <img src={publicAsset(`models/t70-parts/preview_${exploded ? 'exploded' : 'assembled'}.png`)} alt={zh ? '鸿鹄 T70 静态结构示意' : 'Honghu T70 static structure illustration'} />
      ) : (
        <svg viewBox="0 0 600 320" role="img" aria-label={zh ? '柴油拖拉机静态结构示意' : 'Diesel tractor static schematic'}>
          <ellipse cx="300" cy="276" rx="235" ry="16" fill="#081725" opacity=".35" />
          <g stroke="#99dfff" strokeWidth="3" strokeLinejoin="round">
            <path d="M130 220h350v-44H285v-60H170z" fill="#31596e" />
            <path d="M168 116V52h120v124h-35V80h-55v60z" fill="#508da6" />
            <path d="M154 52h150V40H154z" fill="#7ad7ff" />
            <path d="M302 176v-60h146l35 60z" fill="#478fa1" />
            <path d="M340 116V72h12v44" fill="#274957" />
            <circle cx="178" cy="222" r="62" fill="#132634" />
            <circle cx="178" cy="222" r="29" fill="#6096a6" />
            <circle cx="444" cy="237" r="46" fill="#132634" />
            <circle cx="444" cy="237" r="21" fill="#6096a6" />
            <path d="M365 132h65m-65 12h65m-65 12h65" />
          </g>
        </svg>
      )}
      <div className="parts-preview-message" role="status">
        <strong>{reason === 'manual' ? (zh ? '二维部件浏览' : '2D parts browsing') : (zh ? '静态结构示意' : 'Static structure illustration')}</strong>
        {reason !== 'manual' && <p>{reason === 'lost' ? (zh ? '3D 显示已中断，可重试恢复。' : 'The 3D view was interrupted. Retry to restore it.') : reason === 'error' ? (zh ? '3D 模型加载失败，可重试。' : 'The 3D model failed to load. Try again.') : (zh ? '当前未能启动 3D。请启用浏览器图形加速后重试。' : '3D could not start. Enable browser graphics acceleration and retry.')}</p>}
        <p>{zh ? '部件详情与故障示例仍可从部件列表查看。' : 'Part details and fault examples remain available in the parts list.'}</p>
        {onShowParts && <button type="button" className="tractor-tool-button" onClick={onShowParts}>{zh ? '前往二维部件列表' : 'Go to the 2D parts list'}</button>}
        <button type="button" className="tractor-tool-button" onClick={onRetry}>{reason === 'manual' ? (zh ? '返回三维' : 'Return to 3D') : (zh ? '重试 3D' : 'Retry 3D')}</button>
      </div>
    </div>
  );
}
