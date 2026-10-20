import type { GraphicsReason } from './webgl';

export function sceneFallbackCopy(kind: 'campus' | 'hall', reason: GraphicsReason, lang: 'zh' | 'en'): { title: string; note: string } {
  const place = kind === 'campus'
    ? (lang === 'zh' ? '园区' : 'campus')
    : (lang === 'zh' ? '展厅' : 'hall');
  if (reason === 'loading') {
    return {
      title: lang === 'zh' ? `${place}平面示意` : `${place} plan`,
      note: lang === 'zh' ? `正在打开三维${place}…` : `Opening the 3D ${place}…`,
    };
  }
  if (reason === 'lost') {
    return {
      title: lang === 'zh' ? `${place}静态示意` : `Static ${place} plan`,
      note: lang === 'zh'
        ? '图形上下文已中断，已改用静态示意。展区导航仍然可用。'
        : 'The graphics context stopped. This static plan stays available, and zone navigation still works.',
    };
  }
  return {
    title: lang === 'zh' ? `${place}静态示意` : `Static ${place} plan`,
    note: lang === 'zh'
      ? '当前环境没有可用的 WebGL，显示静态示意。展区导航仍然可用。'
      : 'WebGL is unavailable here. This static plan stays on screen, and zone navigation still works.',
  };
}

/** Model workshop copy when the canvas cannot start. The page itself still renders. */
export function modelPreviewFallback(lang: 'zh' | 'en') {
  return {
    title: lang === 'zh' ? '3D 模型预览' : '3D model preview',
    note: lang === 'zh' ? '当前浏览器环境不支持 WebGL' : 'WebGL is unavailable in this browser',
    hint: lang === 'zh' ? '支持的设备上可查看可交互 3D 拖拉机模型' : 'Use a supported device to explore the interactive tractor model',
  };
}
