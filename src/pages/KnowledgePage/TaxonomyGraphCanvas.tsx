import { useState } from 'react';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import KnowledgeEngine from './KnowledgeEngine';
import TaxonomyRelationCanvas from './TaxonomyRelationCanvas';
import { useUiCopy } from '@/ui/useUiCopy';

export default function TaxonomyGraphCanvas(props: { nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; lang: string; catalog: KnowledgeCatalog }) {
  const [relations, setRelations] = useState(false);
  const { t } = useUiCopy(props.lang);
  if (relations) return <><div className="engine-controls"><button onClick={() => setRelations(false)}>← {t('返回三维知识引擎', 'Back to 3D knowledge engine')}</button><span>{t('原有上下级关系聚焦', 'Parent and child relations')}</span></div><TaxonomyRelationCanvas {...props} /></>;
  return <KnowledgeEngine {...props} onRelations={() => setRelations(true)} />;
}
