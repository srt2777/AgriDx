import type { KnowledgeCatalog } from '../../../shared/knowledge-catalog';
import { isCommonFramework } from '../../../shared/common-knowledge';
import { isRecord, requestJson } from '../../lib/api-client';
import { isRiskCoverage, isRoleCoverage } from './catalog-distributions';

const isCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isStrings = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
const hasCounts = (value: Record<string, unknown>) =>
  ['entryCount', 'faultCount', 'sourceCount'].every(key => isCount(value[key])) &&
  (value.entryTypes === undefined || isStrings(value.entryTypes)) &&
  (value.roleCoverage === undefined || isRoleCoverage(value.roleCoverage, Number(value.entryCount))) &&
  (value.riskCoverage === undefined || isRiskCoverage(value.riskCoverage, Number(value.entryCount)));
const hasIdentity = (value: Record<string, unknown>) => typeof value.id === 'string' && typeof value.name === 'string';

function isPart(value: unknown): boolean {
  return isRecord(value) && hasIdentity(value) && hasCounts(value);
}

function isComponent(value: unknown): boolean {
  return isRecord(value) && hasIdentity(value) && hasCounts(value) && isCount(value.unresolvedPartCount) &&
    Array.isArray(value.parts) && value.parts.every(isPart);
}

function isModel(value: unknown): boolean {
  return isRecord(value) && hasIdentity(value) && hasCounts(value) &&
    ['exact', 'series', 'pending'].includes(String(value.scope)) &&
    ['拖拉机', '配套导航系统', '待核实'].includes(String(value.machineType)) &&
    Array.isArray(value.components) && value.components.every(isComponent);
}

function isBrand(value: unknown): boolean {
  return isRecord(value) && hasIdentity(value) && hasCounts(value) &&
    Array.isArray(value.models) && value.models.every(isModel);
}

function isEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const fields = ['entryId', 'title', 'entryType', 'content', 'sourceId', 'sourceUrl', 'locator',
    'version', 'scopeBoundary', 'status', 'knowledgePath'];
  return fields.every(key => typeof value[key] === 'string') &&
    (value.configuration === undefined || value.configuration === 'CAB' || value.configuration === 'ROPS') &&
    (value.driveConfiguration === undefined || value.driveConfiguration === '2WD' || value.driveConfiguration === '4WD') &&
    (value.emissionStage === undefined || value.emissionStage === '国三' || value.emissionStage === '国四');
}

function isSelection(value: unknown): boolean {
  return isRecord(value) && typeof value.brand === 'string' && typeof value.model === 'string' &&
    (value.component === undefined || typeof value.component === 'string') &&
    (value.part === undefined || typeof value.part === 'string') &&
    Array.isArray(value.entries) && value.entries.every(isEntry) && isStrings(value.gaps);
}

function isLibrary(value: unknown): boolean {
  if (!isRecord(value) || !['all', 'archive', 'learning'].includes(String(value.collection)) ||
    typeof value.query !== 'string' || !isCount(value.page) || Number(value.page) < 1 ||
    value.pageSize !== 20 || !isCount(value.total) || !Array.isArray(value.entries) || value.entries.length > 20) return false;
  const valid = value.entries.every(entry => {
    if (!isRecord(entry) || (value.collection !== 'all' && entry.collection !== value.collection)) return false;
    if (entry.collection === 'archive') return isEntry(entry) && typeof entry.brand === 'string' && isStrings(entry.models);
    return entry.collection === 'learning' && entry.entryType === '通识学习' && entry.diagnosticEvidence === false &&
      ['entryId', 'title', 'content', 'topic', 'status', 'knowledgePath'].every(key => typeof entry[key] === 'string');
  });
  const total = Number(value.total), page = Number(value.page);
  return valid && page <= Math.max(1, Math.ceil(total / 20)) &&
    value.entries.length === Math.min(20, Math.max(0, total - (page - 1) * 20)) &&
    new Set(value.entries.map(entry => entry.entryId)).size === value.entries.length;
}

/** Validate every nested collection consumed by the four-level browser before rendering it. */
export function parseKnowledgeCatalog(value: unknown): KnowledgeCatalog {
  if (!isRecord(value) || !isRecord(value.totals)) throw new Error('Invalid knowledge catalog');
  const totals = value.totals;
  if (!['entries', 'archivedEntries', 'learningEntries', 'sources', 'brands', 'models', 'faultEntries', 'mappedEntries'].every(key => isCount(totals[key])) ||
    totals.entries !== Number(totals.archivedEntries) + Number(totals.learningEntries) ||
    !Array.isArray(value.brands) || !value.brands.every(isBrand) || !isStrings(value.limitations) ||
    !isRecord(value.expansion) || value.expansion.targetLabel !== '1w+' ||
    value.expansion.countingUnit !== 'indexed-entry' || !['planned', 'reached'].includes(String(value.expansion.status)) ||
    (value.library !== undefined && !isLibrary(value.library)) ||
    (value.selected !== undefined && !isSelection(value.selected)) ||
    (value.common !== undefined && !isCommonFramework(value.common))) {
    throw new Error('Invalid knowledge catalog');
  }
  return value as unknown as KnowledgeCatalog;
}

const CACHE_TTL = 5 * 60_000;
const CACHE_LIMIT = 32;
const catalogCache = new Map<string, { catalog: KnowledgeCatalog; expires: number }>();

function cacheKey(query: string): string {
  const params = new URLSearchParams(query);
  params.sort();
  return params.toString();
}

/** Tab-local, short-lived evidence cache; each full filter selection has its own key. */
export function getCachedKnowledgeCatalog(query: string): KnowledgeCatalog | null {
  const key = cacheKey(query);
  const cached = catalogCache.get(key);
  if (!cached) return null;
  if (cached.expires <= Date.now()) {
    catalogCache.delete(key);
    return null;
  }
  catalogCache.delete(key);
  catalogCache.set(key, cached);
  return cached.catalog;
}

export function clearCachedKnowledgeCatalog(query: string): void {
  catalogCache.delete(cacheKey(query));
}

export async function requestKnowledgeCatalog(query: string, signal: AbortSignal): Promise<KnowledgeCatalog> {
  signal.throwIfAborted();
  const cached = getCachedKnowledgeCatalog(query);
  if (cached) return cached;
  const catalog = parseKnowledgeCatalog(await requestJson(`/api/knowledge/catalog${query ? `?${query}` : ''}`, { signal }));
  signal.throwIfAborted();
  const key = cacheKey(query);
  catalogCache.delete(key);
  catalogCache.set(key, { catalog, expires: Date.now() + CACHE_TTL });
  if (catalogCache.size > CACHE_LIMIT) catalogCache.delete(catalogCache.keys().next().value!);
  return catalog;
}
