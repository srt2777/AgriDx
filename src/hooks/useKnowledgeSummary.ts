import { useEffect, useState } from 'react';
import { researchKnowledge } from '@shared/research-knowledge';
import { loadLiteratureManifest } from '@/features/knowledge/literature-api';

/** Shared counts for the workbench and knowledge base; unknown totals stay unknown. */
export function useKnowledgeSummary(entries?: number) {
  const [literatureCount, setLiteratureCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void loadLiteratureManifest().then(manifest => {
      if (active) setLiteratureCount(manifest.records);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [revision]);
  const researchCount = researchKnowledge.entries.length;
  return {
    literatureCount, researchCount, failed,
    total: entries !== undefined ? entries + researchCount : undefined,
    retry: () => setRevision(value => value + 1),
  };
}
