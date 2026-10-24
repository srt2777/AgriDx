import React from 'react';
import { Link } from 'react-router-dom';
import { CircleHelp, ListChecks, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { KnowledgeRole, RiskCoverage, RoleCoverage } from '@shared/knowledge-catalog';
import { roleFilterHref } from '../../features/knowledge/catalog-distributions';

const ROLES: { id: KnowledgeRole; zh: string; en: string }[] = [
  { id: 'symptom', zh: '现象', en: 'Symptom' }, { id: 'cause', zh: '原因', en: 'Cause' },
  { id: 'check', zh: '检查', en: 'Check' }, { id: 'action', zh: '处理', en: 'Action' }, { id: 'retest', zh: '复检', en: 'Retest' },
];
const RISKS = [{ id: 'high', zh: '高风险', en: 'High risk' }, { id: 'medium', zh: '中风险', en: 'Medium risk' }, { id: 'low', zh: '低风险', en: 'Low risk' }] as const;

function Bar({ value, maximum }: { value: number; maximum: number }) {
  return <svg className="distribution-bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="100" height="8" rx="4" className="distribution-track" />{value > 0 && <rect width={100 * value / Math.max(1, maximum)} height="8" rx="4" className="distribution-fill" />}</svg>;
}

export default function CatalogDistributions({ roles, risk, loading, failed, retry, lang, params }: {
  roles: RoleCoverage | null; risk: RiskCoverage | null; loading: boolean; failed: boolean;
  retry: () => void; lang: string; params: URLSearchParams;
}) {
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  const unavailable = (title: string) => loading ? <p className="distribution-state" role="status">{t(`正在读取${title}…`, `Loading ${title}…`)}</p>
    : failed ? <div className="distribution-state" role="alert"><TriangleAlert size={18} aria-hidden="true" /><p>{t(`${title}读取失败，未展示推测数量。`, `Could not load ${title}. No estimated counts are shown.`)}</p><button type="button" onClick={retry}>{t('重新加载', 'Retry')}</button></div> : null;
  const roleMaximum = roles ? Math.max(...ROLES.map(role => roles[role.id]), 1) : 1;
  const riskMaximum = risk ? Math.max(risk.high, risk.medium, risk.low, 1) : 1;
  return <section className="catalog-distributions" aria-label={t('归档标注分布', 'Archive annotation distributions')}>
    <figure className="catalog-distribution" aria-labelledby="role-distribution-title">
      <figcaption><h2 id="role-distribution-title"><ListChecks size={18} aria-hidden="true" />{t('角色分布', 'Role distribution')}</h2><p>{t('全库来源归档标注总览，不随搜索或机型筛选变化。', 'Archive-wide annotations, independent of search and model filters.')}</p></figcaption>
      {loading || failed ? unavailable(t('角色分布', 'role distribution')) : <>
        <p className="distribution-summary">{roles ? t(`已标注 ${roles.tagged.toLocaleString()} 条；未标注 ${roles.untagged.toLocaleString()} 条（待核实）。`, `${roles.tagged.toLocaleString()} tagged; ${roles.untagged.toLocaleString()} untagged (needs review).`) : t('接口未提供完整角色汇总，待补资料。', 'Complete role totals are unavailable; evidence needed.')}</p>
        <ul className="distribution-rows">{ROLES.map(role => {
          const value = roles?.[role.id] ?? 0;
          return <li key={role.id} data-gap={value === 0}><Link className="distribution-role" to={roleFilterHref(params, role.id)} aria-current={params.get('role') === role.id ? 'true' : undefined}>
            <span>{t(role.zh, role.en)}</span><Bar value={value} maximum={roleMaximum} /><strong>{value ? t(`${value.toLocaleString()} 条`, `${value.toLocaleString()} entries`) : <><CircleHelp size={14} aria-hidden="true" />{t('待补资料', 'Evidence needed')}</>}</strong>
          </Link></li>;
        })}</ul>
        <p className="distribution-note">{t('同条资料可有多个角色，各角色不可相加为独立条数；点击角色查看归档，保留搜索词。', 'An entry may have multiple roles; role counts are not additive. Select a role to browse archives with your search text.')}</p>
        {params.has('role') && <Link className="distribution-clear" to={roleFilterHref(params)}>{t('清除角色筛选', 'Clear role filter')}</Link>}
      </>}
    </figure>
    <figure className="catalog-distribution" aria-labelledby="risk-distribution-title">
      <figcaption><h2 id="risk-distribution-title"><ShieldAlert size={18} aria-hidden="true" />{t('风险分布', 'Risk distribution')}</h2><p>{t('仅统计有依据的风险标注，不代表设备状态或告警。', 'Reviewed risk labels only; these are not machine states or alerts.')}</p></figcaption>
      {loading || failed ? unavailable(t('风险分布', 'risk distribution')) : <>
        <p className="distribution-summary">{risk?.reviewed ? t(`已核对 ${risk.reviewed.toLocaleString()} 条风险标注。`, `${risk.reviewed.toLocaleString()} reviewed risk labels.`) : t('暂无已核对风险标注，各类别待补资料。', 'No reviewed risk labels; evidence is needed for each category.')}</p>
        <ul className="distribution-rows">{RISKS.map(item => {
          const value = risk?.[item.id] ?? 0;
          return <li key={item.id} data-gap={value === 0} className={`distribution-risk-${item.id}`}><div>
            <span>{t(item.zh, item.en)}</span><Bar value={value} maximum={riskMaximum} /><strong>{value ? t(`${value.toLocaleString()} 条`, `${value.toLocaleString()} entries`) : <><CircleHelp size={14} aria-hidden="true" />{t('待补资料', 'Evidence needed')}</>}</strong>
          </div></li>;
        })}</ul>
        <p className="distribution-note">{risk ? t(`未标注 ${risk.unreviewed.toLocaleString()} 条（待核实），不等于低风险；通识与资料索引不计入风险分布。`, `${risk.unreviewed.toLocaleString()} unreviewed entries are not low risk. Learning notes and document indexes are excluded.`) : t('接口未提供完整风险汇总，不能推定低风险或已覆盖。', 'Complete risk totals are unavailable; low risk or coverage cannot be inferred.')}</p>
      </>}
    </figure>
  </section>;
}
