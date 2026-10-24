import { useEffect, useState } from 'react';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import { clearCachedKnowledgeCatalog, getCachedKnowledgeCatalog, requestKnowledgeCatalog } from '@/features/knowledge/catalog-api';

interface CatalogResult {
  query: string;
  revision: number;
  catalog: KnowledgeCatalog | null;
  loading: boolean;
  failed: boolean;
}

function initialResult(query: string, revision: number): CatalogResult {
  const catalog = getCachedKnowledgeCatalog(query);
  return { query, revision, catalog, loading: !catalog, failed: false };
}

export function useKnowledgeCatalog(query = '') {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(() => initialResult(query, 0));
  useEffect(() => {
    const cached = initialResult(query, revision);
    setResult(cached);
    if (cached.catalog) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const load = async () => {
      try {
        const data = await requestKnowledgeCatalog(query, controller.signal);
        if (active) setResult({ query, revision, catalog: data, loading: false, failed: false });
      } catch {
        if (active) setResult({ query, revision, catalog: null, loading: false, failed: true });
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [query, revision]);
  // A changed URL must never display the preceding model's evidence, even for one render.
  const current = result.query === query && result.revision === revision ? result : initialResult(query, revision);
  return { catalog: current.catalog, loading: current.loading, failed: current.failed, retry: () => {
    clearCachedKnowledgeCatalog(query);
    setRevision(value => value + 1);
  } };
}
