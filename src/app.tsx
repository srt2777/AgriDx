import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import PageLoading from '@/components/PageLoading';
import { pageLoaders } from '@/lib/page-loaders';
import AutoUpdateStatus from '@/features/updates/AutoUpdateStatus';
const HomePage = lazy(pageLoaders.classic);
const ChatPage = lazy(pageLoaders.chat);
const KnowledgePage = lazy(pageLoaders.knowledge);
const ModelPage = lazy(pageLoaders.models);
const VersionHistoryPage = lazy(pageLoaders.history);
const FaultDetectionPage = lazy(pageLoaders.faultDetection);
import NotFoundPage from '@/pages/NotFoundPage/NotFoundPage';
import CommandPalette from '@/components/CommandPalette';
import { NewVersionDelight } from '@/components/NewVersionDelight';
import { ThemedToaster } from '@/components/ThemedToaster';
import { useUiVersion } from '@/hooks/useUiVersion';
const ExhibitionPage = lazy(pageLoaders.exhibition);
const HallPage = lazy(pageLoaders.hall);
const PreviewStatus = typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__
  ? lazy(() => import('./dev-preview/PreviewStatus')) : null;
const DeveloperPage = typeof __AGRIDX_DEV_PREVIEW__ !== 'undefined' && __AGRIDX_DEV_PREVIEW__
  ? lazy(() => import('./dev-preview/DeveloperPage')) : null;

function PageContent({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const version = useUiVersion();
  // Reset only the content boundary: the header remains available during a slow route load.
  const reveal = pathname === '/' ? 'route-home-reveal' : version === 'new' ? 'route-shell-reveal' : 'route-content-reveal';
  return <Suspense key={pathname} fallback={<PageLoading />}>
    <div key={pathname === '/' ? version : pathname} className={reveal}>{children}</div>
  </Suspense>;
}

function NewCommandPalette() {
  const version = useUiVersion();
  if (version !== 'new') return null;
  return <CommandPalette />;
}

function NewVersionChrome() {
  const version = useUiVersion();
  if (version !== 'new') return null;
  return <NewVersionDelight />;
}

function VersionedHomePage() {
  const version = useUiVersion();
  return version === 'new' ? <ExhibitionPage /> : <HomePage />;
}

export default function App() {
  return (
    <>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PageContent><VersionedHomePage /></PageContent>} />
        <Route path="chat" element={<PageContent><ChatPage /></PageContent>} />
        <Route path="knowledge" element={<PageContent><KnowledgePage /></PageContent>} />
        <Route path="models" element={<PageContent><ModelPage /></PageContent>} />
        <Route path="fault-detection" element={<PageContent><FaultDetectionPage /></PageContent>} />
        <Route path="version-history" element={<PageContent><VersionHistoryPage /></PageContent>} />
        <Route path="hall" element={<PageContent><HallPage /></PageContent>} />
      </Route>
      {DeveloperPage && <Route path="developer" element={<PageContent><DeveloperPage /></PageContent>} />}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    {PreviewStatus && <Suspense fallback={null}><PreviewStatus /></Suspense>}
    <NewCommandPalette />
    <NewVersionChrome />
    <ThemedToaster />
    <AutoUpdateStatus />
    </>
  );
}
