import { useState } from 'react';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import KnowledgeEngine from './KnowledgeEngine';
import TaxonomyRelationCanvas from './TaxonomyRelationCanvas';
import { useUiCopy } from '@/ui/useUiCopy';

export default function TaxonomyGraphCanvas(props: { nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; lang: string; catalog: KnowledgeCatalog }) {
  const [relations, setRelations] = useState(false);
  const { t } = useUiCopy(props.lang);
  return <>
    <div hidden={relations}><KnowledgeEngine {...props} enabled={!relations} onRelations={() => setRelations(true)} /></div>
    {relations && <><div className="engine-controls"><button onClick={() => setRelations(false)}>{t('返回图谱', 'Back to graph')}</button></div><TaxonomyRelationCanvas {...props} /></>}
  </>;
}
