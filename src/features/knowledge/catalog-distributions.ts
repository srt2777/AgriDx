import { KNOWLEDGE_ROLES, type KnowledgeCatalog, type KnowledgeRole, type RiskCoverage, type RoleCoverage } from '../../../shared/knowledge-catalog';

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isSummary = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function isRoleCoverage(value: unknown, entryCount: number): value is RoleCoverage {
  if (!isCount(entryCount) || !isSummary(value) || ![...KNOWLEDGE_ROLES, 'tagged', 'untagged'].every(key => isCount(value[key]))) return false;
  const tagged = Number(value.tagged);
  return tagged + Number(value.untagged) <= entryCount &&
    KNOWLEDGE_ROLES.every(role => Number(value[role]) <= tagged) &&
    KNOWLEDGE_ROLES.reduce((sum, role) => sum + Number(value[role]), 0) >= tagged;
}

export function isRiskCoverage(value: unknown, entryCount: number): value is RiskCoverage {
  if (!isCount(entryCount) || !isSummary(value) || !['high', 'medium', 'low', 'reviewed', 'unreviewed'].every(key => isCount(value[key]))) return false;
  return Number(value.high) + Number(value.medium) + Number(value.low) === value.reviewed &&
    Number(value.reviewed) + Number(value.unreviewed) <= entryCount;
}

/** Brand roots partition the archive. Model/component/part counts overlap and must never be added here. */
export function catalogDistributions(catalog: KnowledgeCatalog): { roles: RoleCoverage | null; risk: RiskCoverage | null } {
  const roles: RoleCoverage = { symptom: 0, cause: 0, check: 0, action: 0, retest: 0, tagged: 0, untagged: 0 };
  const risk: RiskCoverage = { high: 0, medium: 0, low: 0, reviewed: 0, unreviewed: 0 };
  const unique = new Set(catalog.brands.map(brand => brand.id)).size === catalog.brands.length;
  const entries = catalog.brands.reduce((sum, brand) => sum + brand.entryCount, 0);
  if (!unique || !isCount(entries) || entries !== catalog.totals.archivedEntries) return { roles: null, risk: null };
  let hasRoles = true, hasRisk = true;
  for (const brand of catalog.brands) {
    if (isRoleCoverage(brand.roleCoverage, brand.entryCount)) {
      for (const key of Object.keys(roles) as (keyof RoleCoverage)[]) roles[key] += brand.roleCoverage[key];
    } else hasRoles = false;
    if (isRiskCoverage(brand.riskCoverage, brand.entryCount)) {
      for (const key of Object.keys(risk) as (keyof RiskCoverage)[]) risk[key] += brand.riskCoverage[key];
    } else hasRisk = false;
  }
  return {
    roles: hasRoles && isRoleCoverage(roles, entries) ? roles : null,
    risk: hasRisk && isRiskCoverage(risk, entries) ? risk : null,
  };
}

/** Role search is the existing archive library; keep search text and reset incompatible view/pagination filters. */
export function roleFilterHref(current: URLSearchParams, role?: KnowledgeRole): string {
  const next = new URLSearchParams(current);
  for (const key of ['view', 'brand', 'model', 'component', 'part', 'symptom', 'configuration', 'driveConfiguration', 'emissionStage', 'kind', 'topic', 'entryType', 'page']) next.delete(key);
  next.set('collection', 'archive');
  if (role) next.set('role', role); else next.delete('role');
  return `/knowledge?${next}`;
}
