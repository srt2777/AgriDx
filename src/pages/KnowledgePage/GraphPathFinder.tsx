import { useMemo, useState } from 'react';
import { useUiCopy } from '@/ui/useUiCopy';
import type { TaxonomyNode } from './knowledge-taxonomy-data';
import { membershipPath } from './knowledge-graph-path';

export default function GraphPathFinder({ nodes, selectedId, onSelect, lang }: { nodes: TaxonomyNode[]; selectedId: string; onSelect: (id: string) => void; lang: string }) {
  const { t } = useUiCopy(lang);
  const [pathStart, setPathStart] = useState('');
  const [pathRequested, setPathRequested] = useState(false);
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);
  const startNode = byId.get(pathStart), selected = byId.get(selectedId);
  const route = useMemo(() => pathRequested && startNode && selected ? membershipPath(nodes, startNode.id, selected.id) : null, [nodes, pathRequested, startNode, selected]);
  return <section className="taxonomy-path-finder" aria-label={t('查询目录路径', 'Find a catalog path')}>
    <div><strong>{t('查询目录路径', 'Find a catalog path')}</strong><p>{pathStart ? t(`起点：${startNode?.label ?? '当前筛选中不可见'}`, `Start: ${startNode?.label ?? 'hidden by current filters'}`) : t('选择图谱节点后设为起点，再选择终点。', 'Select a node as the start, then select a destination.')}</p></div>
    <div className="taxonomy-path-actions"><button type="button" disabled={!selected} onClick={() => { setPathStart(selectedId); setPathRequested(false); }}>{t('设为起点', 'Set start')}</button><button type="button" disabled={!startNode || !selected} onClick={() => setPathRequested(true)}>{t('查找路径', 'Find path')}</button><button type="button" disabled={!pathStart} onClick={() => { setPathStart(''); setPathRequested(false); }}>{t('清除', 'Clear')}</button></div>
    {pathRequested && startNode && selected && <div role="status" className="taxonomy-path-result">{route ? <><p>{t('目录归属路径；选择节点可查看资料。', 'Catalog membership path; select a node to inspect its sources.')}</p><ol>{route.map(node => <li key={node.id}><button type="button" onClick={() => { onSelect(node.id); setPathRequested(false); }}>{node.label}</button></li>)}</ol></> : <p>{t('这两个节点之间没有现有目录归属路径。', 'There is no catalog membership path between these nodes.')}</p>}</div>}
  </section>;
}
