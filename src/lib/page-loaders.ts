import type { UiVersion } from '@/hooks/useUiVersion';

export const pageLoaders = {
  research: () => import('@/pages/ResearchPage/ResearchPage'),
  faultDetection: () => import('@/pages/FaultDetectionPage/FaultDetectionPage'),
  history: () => import('@/pages/VersionHistoryPage/VersionHistoryPage'),
  classic: () => import('@/pages/HomePage/HomePage'),
  exhibition: () => import('@/pages/ExhibitionPage/ExhibitionPage'),
  knowledge: () => import('@/pages/KnowledgePage/KnowledgePage'),
  chat: () => import('@/pages/ChatPage/ChatPage'),
  models: () => import('@/pages/ModelPage/ModelPage'),
};

const prefetched = new Set<keyof typeof pageLoaders>();

/** Warm a page on navigation intent, without loading its optional 3D scene. */
export function preloadPage(path: string, version: UiVersion = 'new') {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType ?? '')) return;
  const requested = path.split(/[?#]/, 1)[0];
  const pathname = requested === '/hall' ? '/' : requested;
  const page = pathname === '/' ? version === 'new' ? 'exhibition' : 'classic'
    : pathname === '/knowledge' ? 'knowledge' : pathname === '/chat' ? 'chat'
      : pathname === '/research' ? 'research' : pathname === '/fault-detection' ? 'faultDetection' : pathname === '/version-history' ? 'history' : pathname === '/models' ? 'models' : null;
  if (!page || prefetched.has(page)) return;
  prefetched.add(page);
  void pageLoaders[page]().catch(() => prefetched.delete(page));
}
