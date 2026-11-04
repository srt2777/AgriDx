import { useState } from 'react';
import type { ChatKnowledgeSource } from '../../../shared/chat';
import { matchesEvidenceFilter, reviewEvidence, type EvidenceFilter } from '@/features/chat/evidence-review';

type Props = { sources: ChatKnowledgeSource[]; t: (zh: string, en: string) => string };
export function EvidenceReview({ sources, t }: Props) {
  const [filter, setFilter] = useState<EvidenceFilter>('all');
  const entries = sources.map((source, index) => ({ source, index, review: reviewEvidence(source) }));
  const filters: { id: EvidenceFilter; label: string }[] = [
    { id: 'all', label: t('全部资料', 'All sources') }, { id: 'needs-review', label: t('待核对', 'Needs review') },
    { id: 'general', label: t('通识', 'General knowledge') }, { id: 'reference-only', label: t('仅参考', 'Reference only') },
  ];
  const visible = entries.filter(({ review }) => matchesEvidenceFilter(review, filter));
  return <section className="evidence-review" aria-label={t('分项证据核对', 'Evidence checks')}>
    <h3 className="font-semibold text-foreground">{t('分项证据核对', 'Evidence checks')}</h3>
    <p className="my-2">{t('分别查看来源标记、适用范围、原文定位和引用用途。检查仅使用已保存的元数据，不判断原文是否支持每句回答，也不代表故障已确认。', 'Inspect provenance, applicability, location and use separately. These checks use saved metadata; they do not verify every claim or confirm a fault.')}</p>
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('筛选证据', 'Filter evidence')}>
      {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className="evidence-review-filter min-h-9 rounded-md border border-border px-3 py-2">{item.label} ({entries.filter(({ review }) => matchesEvidenceFilter(review, item.id)).length})</button>)}
    </div>
    {!sources.length ? <p>{t('这条对话没有保存结构化来源；请补充机型和资料，历史文字不会自动变成证据。', 'No structured sources were saved. Add machine details and sources; older text is not evidence.')}</p>
      : !visible.length ? <p role="status">{t('此筛选下没有资料；不表示回答已获验证。', 'No sources match this filter; the answer is not thereby verified.')}</p>
      : <ol className="space-y-3">{visible.map(({ source, index, review }) => <li key={`${source.entryId || source.source}-${index}`} className="evidence-review-item rounded-md border border-border p-3">
        <p className="font-medium text-foreground">{index + 1}. {source.heading}</p>
        <p>{source.sourceTitle || source.sourceId || source.source}</p>
        <dl className="my-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div><dt>{t('来源标记', 'Provenance')}</dt><dd className="font-medium text-foreground">{review.provenance === 'verified' ? t('已索引 · 标记已核验', 'Indexed · marked reviewed') : review.provenance === 'general' ? t('通识 · 非具体机型手册', 'General · not a model manual') : review.provenance === 'failed' ? t('核验失败 · 需回查来源', 'Verification failed · inspect source') : t('核验或索引信息不足', 'Review or indexing information missing')}</dd></div>
          <div><dt>{t('适用范围', 'Applicability')}</dt><dd className="font-medium text-foreground">{review.scope === 'matched' ? t('标记匹配 · 仍需核对配置', 'Marked matched · check configuration') : review.scope === 'general' ? t('通用参考 · 非本机适用证明', 'General reference · no model proof') : t('待核对机型与配置', 'Check model and configuration')}</dd></div>
          <div><dt>{t('原文定位', 'Source location')}</dt><dd className="font-medium text-foreground">{review.location === 'not-applicable' ? t('通识（无手册页码）', 'General knowledge (no manual pages)') : review.location === 'present' ? [source.pages?.pdf ? t(`PDF第${source.pages.pdf}页`, `PDF p. ${source.pages.pdf}`) : '', source.pages?.printed ? t(`印刷第${source.pages.printed}页`, `Printed p. ${source.pages.printed}`) : '', source.locator].filter(Boolean).join(' · ') : t('缺少页码或定位', 'Page or locator missing')}</dd></div>
          <div><dt>{t('引用用途', 'Use in this reply')}</dt><dd className="font-medium text-foreground">{review.usage === 'answer-evidence' ? t('资料分析依据 · 非确诊', 'Evidence analysis · not a diagnosis') : review.usage === 'prompt-context' ? t('AI参考上下文 · 非逐句支持证明', 'AI context · not claim verification') : review.usage === 'reference-only' ? t('仅供参考 · 非本机操作依据', 'Reference only · not machine instructions') : t('用途未记录', 'Use was not recorded')}</dd></div>
        </dl>
        {review.needsReview && <p className="evidence-review-note">{t('先补齐待核对项；不要据此直接执行维修。', 'Resolve the pending checks before relying on this source for repairs.')}</p>}
        <details className="mt-3"><summary className="cursor-pointer">{t('展开原始来源与适用条件', 'Inspect original source and scope')}</summary><div className="mt-2 space-y-1">
          <p>{[source.entryId, source.sourceId, source.version].filter(Boolean).join(' · ')}</p>
          {source.scopeBoundary && <p>{t('适用范围：', 'Scope: ')}{source.scopeBoundary}</p>}
          {!!source.models?.length && <p>{t('型号：', 'Models: ')}{source.models.join('、')}</p>}
          {source.engineModel && <p>{t('发动机：', 'Engine: ')}{source.engineModel}</p>}
          {!!source.faultCodes?.length && <p>{t('故障码：', 'Codes: ')}{source.faultCodes.join('、')}</p>}
          {source.status && <p>{t('原始核验说明：', 'Original review status: ')}{source.status}</p>}
          {source.retrieval && <p>{t('检索层级：', 'Retrieval tier: ')}{source.retrieval.tier} · {source.retrieval.basis.join('；')}</p>}
        </div></details>
      </li>)}</ol>}
  </section>;
}
