import { useUiCopy } from '@/ui/useUiCopy';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import { taxonomyNodes, type TaxonomyNode } from './knowledge-taxonomy-data';
import TaxonomyGraphCanvas from './TaxonomyGraphCanvas';
import EvidenceEntry from './EvidenceEntry';
import './knowledge-taxonomy.css';

export default function KnowledgeGraph({ catalog, lang }: { catalog: KnowledgeCatalog; lang: string }) {
  const { t, separator } = useUiCopy(lang);
  const nodes = useMemo(() => taxonomyNodes(catalog).filter(node => node.query.brand !== '千寻位置'), [catalog]);
  const [selectedId, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const selected = nodes.find(node => node.id === selectedId);
  const path: TaxonomyNode[] = [];
  let ancestor = selected;
  while (ancestor) { path.unshift(ancestor); ancestor = nodes.find(node => node.id === ancestor?.parent); }
  const selectedBrand = path.find(node => node.level === 'brand');
  const selectedModel = path.find(node => node.level === 'model');
  const selectedComponent = path.find(node => node.level === 'component');
  const query = new URLSearchParams(selected?.query ?? {}).toString();
  const details = useKnowledgeCatalog(query);
  const model = catalog.brands.find(brand => brand.id === selectedBrand?.query.brand)?.models.find(model => model.id === selectedModel?.query.model);
  const component = model?.components.find(item => item.id === selectedComponent?.query.component);
  const state = { brand: selectedBrand?.label, model: model?.scope === 'exact' ? model.name : '', question: t('请先核对完整机型、配置与资料适用范围，再结合已有证据分析。', 'Confirm the model, configuration and applicability before reviewing evidence.') };
  const pathLabel = (node: TaxonomyNode) => {
    const labels: string[] = [];
    let current: TaxonomyNode | undefined = node;
    while (current) { labels.unshift(current.label); const parent: string | undefined = current.parent; current = nodes.find(item => item.id === parent); }
    return labels.join(' / ');
  };
  const searchTerm = search.trim().toLocaleLowerCase();
  const results = searchTerm ? nodes.filter(node => node.label.toLocaleLowerCase().includes(searchTerm)) : [];
  const levels = [
    { level: 'brand', label: t('品牌', 'Brand'), parent: undefined },
    { level: 'model', label: t('机型 / 系列', 'Model / series'), parent: selectedBrand?.id },
    { level: 'component', label: t('系统 / 组件', 'System / component'), parent: selectedModel?.id },
    { level: 'part', label: t('零部件', 'Part'), parent: selectedComponent?.id },
  ];
  return <section className="knowledge-taxonomy" aria-labelledby="taxonomy-heading">
    <header className="taxonomy-heading"><div><span>TAXONOMY / EVIDENCE</span><h2 id="taxonomy-heading">{t('沿知识结构，找到依据。', 'Follow the knowledge structure to evidence.')}</h2><p>{t('旋转探索真实知识库的三维结构，沿连线查看品牌、机型、系统与零部件。下方分析看板为模拟数据，连线仅表示目录归属。', 'Explore the real catalog in 3D. Links show membership across brands, models, systems and parts. Analytics below use simulated data.')}</p></div><strong>{nodes.length.toLocaleString()}<small>{t('目录节点 · 非独立知识条数', 'catalog nodes · not unique entries')}</small></strong></header>
    <div className="taxonomy-search"><label htmlFor="taxonomy-search">{t('定位知识节点', 'Find a knowledge node')}</label><input id="taxonomy-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('搜索品牌、机型、系统或零件', 'Search brand, model, system or part')} />{searchTerm && <div className="taxonomy-results"><p>{t(`找到 ${results.length} 个节点，显示前 50 个`, `${results.length} matches; showing the first 50`)}</p>{results.slice(0, 50).map(node => <button key={node.id} onClick={() => { setSelected(node.id); setSearch(''); }}>{node.label}<small>{pathLabel(node)}</small></button>)}{!results.length && <p>{t('无匹配节点；未生成推测知识。', 'No matches; no knowledge inferred.')}</p>}</div>}</div>
    <nav className="taxonomy-trail" aria-label={t('当前知识路径', 'Current knowledge path')}><button onClick={() => setSelected('')}>{t('全部归档', 'All archives')}</button>{path.map(node => <span key={node.id}><span aria-hidden="true"> → </span><button onClick={() => setSelected(node.id)} aria-current={selected?.id === node.id ? 'location' : undefined}>{node.label}</button></span>)}</nav>
    <TaxonomyGraphCanvas catalog={catalog} nodes={nodes} selectedId={selectedId} onSelect={setSelected} lang={lang} />
    <details className="taxonomy-accessible-directory"><summary>{t('展开目录辅助浏览（键盘 / 无图形模式）', 'Browse directory (keyboard / non-graph mode)')}</summary><div className="taxonomy-columns">{levels.map(({ level, label, parent }, index) => {
      const children = nodes.filter(node => node.level === level && (level === 'brand' || !!parent && node.parent === parent));
      return <section className="taxonomy-column" key={level} aria-label={label}><h3><span>{String(index + 1).padStart(2, '0')}</span>{label}<small>{children.length}</small></h3><div className="taxonomy-node-list">{children.map(node => <button className={node.count ? '' : 'taxonomy-gap'} key={node.id} aria-pressed={path.some(item => item.id === node.id)} onClick={() => setSelected(node.id)}><span>{node.label}</span><small>{node.count ? t(`${node.count} 条关联资料`, `${node.count} linked entries`) : t('待补资料', 'Evidence gap')}{node.scope && `${separator}${node.scope === 'exact' ? t('具体型号范围', 'Specific model') : node.scope === 'series' ? t('系列范围', 'Series scope') : t('待核实', 'Unconfirmed')}`}</small></button>)}{!children.length && <p>{parent ? t('本层尚无已定位节点；保留在上层查看资料。', 'No identified nodes; review evidence at the parent level.') : t('先选择左侧上级目录。', 'Select a parent to continue.')}</p>}</div></section>;
    })}</div></details>
    <section className="taxonomy-evidence" aria-labelledby="taxonomy-evidence-heading"><header><h3 id="taxonomy-evidence-heading">{t('原始知识与来源', 'Original knowledge & sources')}{selected && ` / ${selected.label}`}</h3>{selectedModel && <Link to="/chat" className="catalog-action" state={state}>{t('带机型去诊断', 'Diagnose with this model')}</Link>}</header>
      {!selectedModel ? <p>{t('请选择机型，再查看原始条目、页码与核验状态。品牌只是分类入口，不自动选择机型。', 'Select a model to review entries, page references and verification. A brand does not select a model automatically.')}</p> : <>
        <p>{t('型号、配置和版本仍须核对；目录关系不等于维修覆盖。通识资料继续在独立入口浏览。', 'Check the model, configuration and version. Membership does not imply repair coverage. General learning remains separate.')}</p>
        {component && <p>{t(`${component.unresolvedPartCount} 条资料尚未明确零件，保留在组件层级。`, `${component.unresolvedPartCount} entries identify no specific part and remain at component level.`)}</p>}
        {details.loading && <p role="status">{t('正在读取原始知识…', 'Loading evidence…')}</p>}
        {details.failed && <div role="alert"><p>{t('资料加载失败', 'Evidence failed to load')}</p><button onClick={details.retry}>{t('重试', 'Retry')}</button></div>}
        {!details.loading && !details.failed && <><p>{details.catalog?.selected?.entries.length ?? 0} {t('条匹配资料', 'matching entries')}</p>{details.catalog?.selected?.gaps.map(gap => <p className="taxonomy-gap-note" key={gap}>{gap}</p>)}{details.catalog?.selected?.entries.map(entry => <EvidenceEntry key={entry.entryId} entry={entry} diagnosisState={state} />)}{!details.catalog?.selected?.entries.length && <p>{t('暂无匹配资料，不补造关系。', 'No matching evidence; no relations invented.')}</p>}</>}
      </>}
    </section>
    <footer>{t('分类组织参考 os-taxonomy；节点、顺序与归属全部来自 AgriDx 已有知识库。未导入教育课程数据，未添加无证据的先修关系。', 'Organization inspired by os-taxonomy. Nodes, order and membership come from the AgriDx catalog; no curriculum data or unsupported prerequisites are imported.')} <a href="https://github.com/withmarbleapp/os-taxonomy" target="_blank" rel="noreferrer">os-taxonomy ↗</a></footer>
  </section>;
}
