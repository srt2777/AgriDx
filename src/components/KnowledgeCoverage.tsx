import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, Database, Loader2 } from 'lucide-react';
import { useLang } from '@/hooks/useLang';
import { useKnowledgeCatalog } from '@/hooks/useKnowledgeCatalog';


export default function KnowledgeCoverage() {
  const lang = useLang();
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const { catalog, loading, failed } = useKnowledgeCatalog();
  return <section id="knowledge" className="knowledge-section" data-home-beat="knowledge" data-home-side="end">
    <div className="page-container">
      <div className="section-heading">
        <div className="section-eyebrow">{t('耕知 从资料到结构', 'GENGZHI FROM DOCUMENTS TO STRUCTURE')}</div>
        <h2>{t('从零部件，到整机表现。', 'From individual parts to the whole machine.')}</h2>
        <p className="mt-4">{t('按品牌与机型找到适用资料，沿组件与零部件查看运行故障表现和对应策略。覆盖多少、缺少什么，都在知识浏览中看得见。', 'Find applicable documents by brand and model, then explore symptoms and strategies by component and part. Coverage and gaps remain visible.')}</p>
      </div>
      <div className="knowledge-path" aria-label={t('分层知识结构', 'Knowledge hierarchy')}>
        {[
          [t('品牌', 'Brand'), t('确定装备来源', 'Identify the manufacturer')],
          [t('型号', 'Model'), t('核对配置与适用范围', 'Check configuration & scope')],
          [t('组件', 'Component'), t('理解功能与运行表现', 'Understand function & behavior')],
          [t('零部件', 'Part'), t('定位异常与处置策略', 'Locate symptoms & strategies')],
        ].map(([name, detail], index) => <div key={name} className="knowledge-path-step"><span className="knowledge-step-no">0{index + 1}</span><strong>{name}</strong><p>{detail}</p>{index < 3 && <ChevronRight size={18} aria-hidden="true" />}</div>)}
      </div>
      <div className="knowledge-preview-footer">
        <div className="knowledge-live-count" aria-live="polite"><Database size={18} />
          {loading ? <><Loader2 size={14} className="animate-spin" />{t('读取实际整理数量', 'Loading knowledge counts')}</> : failed ? t('数量暂不可用 可进入知识浏览重试', 'Counts unavailable retry in the knowledge browser') : catalog ? t(`知识合计 ${catalog.totals.entries} 条 来源归档 ${catalog.totals.archivedEntries} 通识学习 ${catalog.totals.learningEntries}`, `${catalog.totals.entries} knowledge entries ${catalog.totals.archivedEntries} archived ${catalog.totals.learningEntries} learning`) : null}
          <span>{t('分层体系已建立，整机性能全覆盖仍在推进。', 'The hierarchy is established; full-machine coverage is still in progress.')}</span>
        </div>
        <Link to="/knowledge" className="hero-text-link">{t('查看知识与覆盖缺口', 'Explore knowledge & gaps')}<ArrowRight size={17} /></Link>
      </div>
    </div>
  </section>;
}
