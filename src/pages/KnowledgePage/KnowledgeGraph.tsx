import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { KnowledgeCatalog } from '@shared/knowledge-catalog';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import EvidenceEntry from './EvidenceEntry';
import './knowledge-graph.css';

/** Only projects existing reviewed membership; never infers diagnostic causality. */
export default function KnowledgeGraph({ catalog, lang }: { catalog: KnowledgeCatalog; lang: string }) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const [brandId, setBrand] = useState('');
  const [modelId, setModel] = useState('');
  const [componentId, setComponent] = useState('');
  const [partId, setPart] = useState('');
  const [panel, setPanel] = useState('graph');
  const brand = catalog.brands.find(item => item.id === brandId) ?? catalog.brands[0];
  const model = brand?.models.find(item => item.id === modelId) ?? brand?.models[0];
  const component = model?.components.find(item => item.id === componentId);
  const part = component?.parts.find(item => item.id === partId);
  const query = new URLSearchParams();
  if (brand) query.set('brand', brand.id);
  if (model) query.set('model', model.id);
  if (component) query.set('component', component.id);
  if (part) query.set('part', part.id);
  const { catalog: detail, loading, failed, retry } = useKnowledgeCatalog(query.toString());
  const nodes = component ? component.parts : model?.components ?? [];
  const height = Math.max(300, nodes.length * 64 + 48);
  const choose = (id: string) => { if (component) { setPart(id); setPanel('evidence'); } else { setComponent(id); setPart(''); } };
  const diagnosisState = { brand: brand?.name, model: model?.scope === 'exact' ? model.name : '', question: t(`请先核对${model?.name ?? ''}的完整型号与配置，再结合${part?.name ?? component?.name ?? ''}适用资料进行排查。`, 'Confirm the full model and configuration before troubleshooting from applicable evidence.') };
  return <section className="knowledge-graph" aria-labelledby="graph-title" data-panel={panel}>
    <header className="graph-toolbar"><div><h2 id="graph-title">{t('知识与诊断工作台', 'Knowledge & diagnosis workspace')}</h2><small>{t('目录关系 · 来源可追溯 · 非故障因果推断', 'Directory relations · Traceable sources · No inferred causality')}</small></div><Link className="catalog-action" to="/chat" state={diagnosisState}>{t('进入诊断', 'Diagnose')}</Link></header>
    <nav className="graph-mobile-tabs" aria-label={t('工作区面板', 'Workspace panels')}>{[['directory', t('目录', 'Directory')], ['graph', t('图谱', 'Graph')], ['evidence', t('证据', 'Evidence')]].map(([id, label]) => <button key={id} aria-pressed={panel === id} onClick={() => setPanel(id)}>{label}</button>)}</nav>
    <div className="graph-workspace">
      <aside className="graph-directory">
        <label>{t('品牌', 'Brand')}<select value={brand?.id ?? ''} onChange={event => { setBrand(event.target.value); setModel(''); setComponent(''); setPart(''); }}>{catalog.brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>{t('机型 / 系列', 'Model / series')}<select value={model?.id ?? ''} onChange={event => { setModel(event.target.value); setComponent(''); setPart(''); }}>{brand?.models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <h3>{t('系统目录', 'Systems')}</h3>
        {model?.components.map(item => <button className="graph-directory-node" key={item.id} aria-pressed={component?.id === item.id} onClick={() => { setComponent(item.id); setPart(''); setPanel('graph'); }}><span>{item.name}</span><small>{item.entryCount || t('缺口', 'Gap')}</small></button>)}
        <p>{t('系列资料不能代表全部型号，配置须与铭牌核对。', 'Series documents do not cover every model. Check the machine plate.')}</p>
      </aside>
      <div className="graph-explorer">
        <div className="graph-breadcrumb"><button onClick={() => { setComponent(''); setPart(''); }}>{model?.name ?? t('暂无机型', 'No models')}</button>{component && <span> / {component.name}</span>}{part && <span> / {part.name}</span>}</div>
        <div className="graph-canvas"><svg viewBox={`0 0 760 ${height}`} role="group" aria-label={t('知识目录关系图', 'Knowledge membership graph')}>
          <title>{component?.name ?? model?.name}</title>
          {nodes.map((node, index) => <line key={node.id} x1="200" y1={height / 2} x2="405" y2={48 + index * 64} />)}
          <rect x="8" y={height / 2 - 28} width="192" height="56" rx="6" />
          <text x="104" y={height / 2 + 5} textAnchor="middle">{component?.name ?? model?.name}</text>
          {nodes.map((node, index) => <g key={node.id} role="button" tabIndex={0} aria-label={`${node.name} · ${node.entryCount}`} aria-pressed={part?.id === node.id} onClick={() => choose(node.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(node.id); } }}><rect x="405" y={20 + index * 64} width="340" height="56" rx="6" /><text x="420" y={54 + index * 64}>{node.name} · {node.entryCount}</text></g>)}
        </svg></div>
        {!nodes.length && <p>{t('本层暂无已定位关系，请查看右侧资料与缺口。', 'No identified relations at this level. See evidence and gaps.')}</p>}
        <footer>{t('实线：已整理的目录归属。点击节点展开；查看证据后再判断。', 'Lines: reviewed directory membership. Select a node to explore its evidence.')}{component && <p>{t(`未明确具体零件的条目：${component.unresolvedPartCount}`, `Entries without identified parts: ${component.unresolvedPartCount}`)}</p>}</footer>
      </div>
      <aside className="graph-evidence" aria-live="polite"><h3>{t('适用资料与证据', 'Applicable evidence')}</h3>
        {loading && <p role="status">{t('正在读取资料…', 'Loading evidence…')}</p>}
        {failed && <div role="alert"><p>{t('资料读取失败', 'Evidence unavailable')}</p><button onClick={retry}>{t('重试', 'Retry')}</button></div>}
        {!loading && !failed && <><p>{detail?.selected?.entries.length ?? 0} {t('条资料 · 保留原始核验状态', 'entries · Original verification status retained')}</p>{detail?.selected?.gaps.map(gap => <p className="graph-gap" key={gap}>{gap}</p>)}{detail?.selected?.entries.map(entry => <EvidenceEntry key={entry.entryId} entry={entry} diagnosisState={{ ...diagnosisState, question: `${entry.title}。${diagnosisState.question}` }} />)}{!detail?.selected?.entries.length && <p>{t('暂无匹配资料，不补造关联。', 'No matching evidence. No relations are invented.')}</p>}</>}
      </aside>
    </div>
  </section>;
}
