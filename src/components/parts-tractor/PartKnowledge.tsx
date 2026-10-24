import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CircleHelp, TriangleAlert } from 'lucide-react';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';
import type { PartsModelId } from './parts-catalog';
import { partKnowledgeCount, partKnowledgeLookup, type PartKnowledgeLookup } from './part-knowledge';

export default function PartKnowledge({ modelId, partId, lang }: { modelId: PartsModelId; partId: string; lang: 'zh' | 'en' }) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const { catalog, loading, failed, retry } = useKnowledgeCatalog();
  const [brandId, setBrandId] = useState('');
  const [manualModel, setManualModel] = useState('');
  const brands = catalog?.brands.filter(brand => brand.models.some(model => model.machineType === '拖拉机')) ?? [];
  const models = brands.find(brand => brand.id === brandId)?.models.filter(model => model.machineType === '拖拉机') ?? [];
  const lookup = catalog ? partKnowledgeLookup(catalog, modelId, partId, brandId, manualModel) : { kind: 'choose' as const };
  return <section className="parts-knowledge" aria-label={t('部件关联知识', 'Part knowledge links')}>
    <h3><BookOpen size={16} aria-hidden="true" />{t('关联知识', 'Related knowledge')}<span>{t('来源归档', 'Source archives')}</span></h3>
    <p>{t('结构示意，不代表实车 CAD。所选资料范围仍需核对完整型号与配置。', 'Structural schematic, not actual vehicle CAD. Verify the complete model and configuration against the selected sources.')}</p>
    {loading ? <p role="status">{t('正在读取资料目录…', 'Loading source catalog…')}</p> : failed || !catalog ? <div role="alert"><p><TriangleAlert size={16} aria-hidden="true" />{t('知识目录读取失败。', 'Could not load the knowledge catalog.')}</p><button type="button" onClick={retry}>{t('重试知识目录', 'Retry catalog')}</button></div> : <>
      {modelId === 'diesel' ? <div className="parts-knowledge-selectors">
        <label>{t('资料品牌', 'Source brand')}<select aria-label={t('部件资料品牌', 'Part source brand')} value={brandId} onChange={event => { setBrandId(event.target.value); setManualModel(''); }}>
          <option value="">{t('请选择资料品牌', 'Choose a source brand')}</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </select></label>
        <label>{t('资料型号 / 系列', 'Source model / series')}<select aria-label={t('部件资料型号', 'Part source model')} value={manualModel} disabled={!brandId} onChange={event => setManualModel(event.target.value)}>
          <option value="">{t('请选择资料范围', 'Choose source scope')}</option>{models.map(model => <option key={model.id} value={model.id}>{model.name}{model.scope !== 'exact' ? t('（范围待核实）', ' (verify scope)') : ''}</option>)}
        </select></label>
      </div> : <p>{t('资料范围：鸿鹄 T70。', 'Source scope: Honghu T70.')}</p>}
      {lookup.kind === 'choose' ? <p className="parts-knowledge-gap"><CircleHelp size={16} aria-hidden="true" />{modelId === 't70' ? t('鸿鹄 T70 资料范围待补资料。', 'Honghu T70 source scope needs evidence.') : t('资料范围待核实；请先选择品牌与型号。', 'Source scope needs verification; choose a brand and model first.')}</p> : <>
        {lookup.scope !== 'exact' && <p className="parts-knowledge-gap"><CircleHelp size={16} aria-hidden="true" />{t('系列或待核实资料，不代表具体机型已覆盖。', 'Series or unconfirmed sources do not establish specific-model coverage.')}</p>}
        {lookup.kind === 'pending' ? <p className="parts-knowledge-gap"><CircleHelp size={16} aria-hidden="true" />{t('该部件待补资料，未借用其他机型的条目。', 'Part evidence needed; entries from other models are not substituted.')}</p>
          : <PartCount key={lookup.query} lookup={lookup} lang={lang} />}
        <Link to={lookup.href}>{lookup.level === 'part' && lookup.kind === 'query' ? t('查阅部件条目与来源', 'Open part entries and sources') : t('查阅所选资料目录', 'Open the selected source catalog')}</Link>
      </>}
    </>}
  </section>;
}

function PartCount({ lookup, lang }: { lookup: PartKnowledgeLookup; lang: 'zh' | 'en' }) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const { catalog, loading, failed, retry } = useKnowledgeCatalog(lookup.kind === 'query' ? lookup.query : '');
  const count = partKnowledgeCount(catalog, lookup);
  if (loading) return <p role="status">{t('正在读取关联条目…', 'Loading linked entries…')}</p>;
  if (failed) return <div role="alert"><p><TriangleAlert size={16} aria-hidden="true" />{t('条目读取失败，未显示推测数量。', 'Could not load entries. No estimated count is shown.')}</p><button type="button" onClick={retry}>{t('重试条目', 'Retry entries')}</button></div>;
  if (count === null) return <p className="parts-knowledge-gap"><CircleHelp size={16} aria-hidden="true" />{t('资料范围未匹配，待核实。', 'Source scope does not match; verification needed.')}</p>;
  if (!count) return <p className="parts-knowledge-gap"><CircleHelp size={16} aria-hidden="true" />{t('待补资料', 'Evidence needed')}</p>;
  return <div className="parts-knowledge-count"><strong>{count.toLocaleString()}</strong><span>{lookup.kind !== 'choose' && lookup.level === 'component' ? t('条组件级资料；尚未细分到该部件。', 'component entries; not yet specific to this part.') : t('条关联知识', 'linked knowledge entries')}</span></div>;
}
