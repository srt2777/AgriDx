import { lazy, Suspense } from 'react';

const MarkdownContent = lazy(() => import('./MarkdownContent'));

/** Keep the real text readable while the optional formatting code arrives. */
export default function DeferredMarkdown({ children }: { children: string }) {
  return <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
    <MarkdownContent>{children}</MarkdownContent>
  </Suspense>;
}
