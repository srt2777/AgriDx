/** One order and one parent model for the entire modern workspace. */
export const MODERN_DESTINATIONS = [
  { path: '/', zh: '大厅', en: 'Hub' },
  { path: '/knowledge', zh: '农机知识', en: 'Knowledge' },
  { path: '/chat', zh: '司稼 · 智能诊断', en: 'Sijia · Diagnosis' },
  { path: '/models', zh: '模型工坊', en: 'Model studio' },
  { path: '/fault-detection', zh: '故障检测演示', en: 'Fault detection demo' },
  { path: '/field-overview', zh: '农机作业总览', en: 'Field overview' },
  { path: '/showroom', zh: '3D 展示大厅', en: 'Showroom' },
] as const;
export interface ModernCrumb { path: string; zh: string; en: string }
export function modernLocation(pathname: string): { sectionPath: string; breadcrumbs: ModernCrumb[] } {
  const path = pathname.split(/[?#]/, 1)[0];
  const home = MODERN_DESTINATIONS[0];
  const current = MODERN_DESTINATIONS.find(item => item.path === path || path === '/hall' && item.path === '/');
  if (current) return { sectionPath: current.path, breadcrumbs: current.path === '/' ? [home] : [home, current] };
  return { sectionPath: '/', breadcrumbs: [home, { path, zh: path === '/version-history' ? '版本历史记录' : '页面', en: path === '/version-history' ? 'Version history' : 'Page' }] };
}
