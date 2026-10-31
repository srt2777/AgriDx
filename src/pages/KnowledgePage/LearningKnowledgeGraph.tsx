import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import { useUiCopy } from '@/ui/useUiCopy';
import KnowledgeEngine from './KnowledgeEngine';
import { learningTaxonomy } from './knowledge-learning-graph';

export default function LearningKnowledgeGraph({ catalog, lang }: { catalog: KnowledgeCatalog; lang: string }) {
  const { t } = useUiCopy(lang);
  const navigate = useNavigate();
  const [selectedId, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const organization = catalog.organization!;
  const labels = useMemo(() => ({ general: t('通用原理', 'General principles'), terminology: t('农业术语', 'Agricultural terminology') }), [t]);
  const nodes = useMemo(() => learningTaxonomy(organization, labels), [organization, labels]);
  const selected = nodes.find(node => node.id === selectedId);
  const query = new URLSearchParams(selected?.query ?? { collection: 'learning' }).toString();
  const term = search.trim().normalize('NFKC').toLocaleLowerCase();
  const results = term ? nodes.filter(node => node.level === 'model' && node.label.normalize('NFKC').toLocaleLowerCase().includes(term)) : [];
  return <section className="knowledge-taxonomy" aria-labelledby="learning-graph-heading">
    <header className="taxonomy-heading"><div><h2 id="learning-graph-heading">{t('通识与术语图谱', 'Learning and terminology map')}</h2>
      <p>{t('连线表示已有主题归属，通识与术语不代表机型维修结论。', 'Links show existing topic membership; learning materials do not establish model-specific repairs.')}</p></div>
      <strong>{nodes.length.toLocaleString()}<small>{t('分类与主题节点', 'collection and topic nodes')}</small></strong></header>
    <div className="taxonomy-search"><label htmlFor="learning-graph-search">{t('定位学习主题', 'Find a learning topic')}</label>
      <input id="learning-graph-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('搜索主题，例如冷却或传动', 'Search topics, such as cooling or transmission')} />
      {term && <div className="taxonomy-results"><p>{t(`找到 ${results.length} 个主题，显示前 50 个`, `${results.length} topics; showing the first 50`)}</p>
        {results.slice(0, 50).map(node => <button type="button" key={node.id} onClick={() => { setSelected(node.id); setSearch(''); }}>{node.label}<small>{node.query.kind === 'terminology' ? labels.terminology : labels.general} / {node.count} {t('条', 'entries')}</small></button>)}
        {!results.length && <p>{t('没有匹配主题，请尝试其他关键词。', 'No matching topics. Try another keyword.')}</p>}</div>}
    </div>
    <p className="taxonomy-lod-note" role="status">{t(`通用原理 ${organization.counts.general.toLocaleString()} 条，农业术语 ${organization.counts.terminology.toLocaleString()} 条。每个主题节点汇总已有条目。`, `${organization.counts.general.toLocaleString()} general entries and ${organization.counts.terminology.toLocaleString()} terminology entries. Each node groups existing records.`)}</p>
    <KnowledgeEngine catalog={catalog} nodes={nodes} selectedId={selectedId} onSelect={setSelected} lang={lang} mode="learning" onRelations={() => navigate(`/knowledge?${query}`)} />
    <div className="learning-graph-summary">{selected ? <><p>{t(`已选择“${selected.label}”，共 ${selected.count.toLocaleString()} 条；保留各条原始状态和用途。`, `Selected ${selected.label}: ${selected.count.toLocaleString()} entries with their original status and use.`)}</p>
      <Link className="catalog-action" to={`/knowledge?${query}`}>{t('浏览此分类的原始条目', 'Browse original entries')}</Link></> : <p>{t('选择分类或主题，再查看对应原始条目。', 'Select a collection or topic to review its original entries.')}</p>}</div>
  </section>;
}
