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
