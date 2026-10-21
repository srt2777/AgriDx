import type { UiVersion } from '@/hooks/useUiVersion';

export const pageLoaders = {
  classic: () => import('@/pages/HomePage/HomePage'),
  exhibition: () => import('@/pages/ExhibitionPage/ExhibitionPage'),
  hall: () => import('@/pages/HallPage/HallPage'),
  knowledge: () => import('@/pages/KnowledgePage/KnowledgePage'),
  chat: () => import('@/pages/ChatPage/ChatPage'),
  models: () => import('@/pages/ModelPage/ModelPage'),
};

const prefetched = new Set<keyof typeof pageLoaders>();

/** Warm a page on navigation intent, without loading its optional 3D scene. */
export function preloadPage(path: string, version: UiVersion = 'new') {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType ?? '')) return;
  const pathname = path.split(/[?#]/, 1)[0];
  const page = pathname === '/' ? version === 'new' ? 'exhibition' : 'classic'
    : pathname === '/knowledge' ? 'knowledge' : pathname === '/chat' ? 'chat'
      : pathname === '/models' ? 'models' : pathname === '/hall' ? 'hall' : null;
  if (!page || prefetched.has(page)) return;
  prefetched.add(page);
  void pageLoaders[page]().catch(() => prefetched.delete(page));
}
