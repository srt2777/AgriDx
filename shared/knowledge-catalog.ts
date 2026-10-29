import type { CommonKnowledgeFramework } from './common-knowledge';
/** Knowledge browsing follows the archived index. Counts never imply full-machine validation. */
export interface CatalogCounts {
  entryCount: number;
  faultCount: number;
  sourceCount: number;
  /** Distinct archived entry types attached to this taxonomy node. */
  entryTypes?: string[];
  /** Entries per reviewed role (entry-roles.jsonl) in this node; untagged entries are only in `untagged`. */
  roleCoverage: RoleCoverage;
  /** Reviewed risk labels only; absent in older catalog responses. Never inferred from roles or symptoms. */
  riskCoverage?: RiskCoverage;
}

export interface CatalogPart extends CatalogCounts {
  id: string;
  name: string;
}

export interface CatalogComponent extends CatalogCounts {
  id: string;
  name: string;
  parts: CatalogPart[];
  /** Entries whose evidence does not identify a specific part. */
  unresolvedPartCount: number;
}

export interface CatalogModel extends CatalogCounts {
  id: string;
  name: string;
  scope: 'exact' | 'series' | 'pending';
  machineType: '拖拉机' | '配套导航系统' | '待核实';
  components: CatalogComponent[];
}

export interface CatalogBrand extends CatalogCounts {
  id: string;
  name: string;
  models: CatalogModel[];
}

export type KnowledgeRole = 'symptom' | 'cause' | 'check' | 'action' | 'retest';
export const KNOWLEDGE_ROLES: readonly KnowledgeRole[] = ['symptom', 'cause', 'check', 'action', 'retest'];
export interface RoleCoverage {
  symptom: number; cause: number; check: number; action: number; retest: number;
  /** Entries with at least one role. */
  tagged: number;
  /** Diagnostic entries not yet tagged (pending human review); not the same as "no role". */
  untagged: number;
}
export interface RiskCoverage {
  high: number;
  medium: number;
  low: number;
  reviewed: number;
  /** Diagnostic archive entries with no reviewed risk label; not equivalent to low risk. */
  unreviewed: number;
}
export interface KnowledgePages { pdf?: string; printed?: string }

export interface CatalogEntry {
  entryId: string;
  title: string;
  entryType: string;
  /** Read directly from the sole archived Markdown body; never a second knowledge copy. */
  content: string;
  sourceId: string;
  sourceUrl: string;
  locator: string;
  version: string;
  scopeBoundary: string;
  status: string;
  knowledgePath: string;
  sourceTitle?: string;
  pages?: KnowledgePages;
  roles?: KnowledgeRole[];
  roleBasis?: '原文标记' | '人工核对';
  riskLevel?: 'high' | 'medium' | 'low';
  configuration?: 'CAB' | 'ROPS';
  driveConfiguration?: '2WD' | '4WD';
  emissionStage?: '国三' | '国四';
}

export interface CatalogSelection {
  brand: string;
  model: string;
  component?: string;
  part?: string;
  entries: CatalogEntry[];
  gaps: string[];
  configuration?: 'CAB' | 'ROPS';
  driveConfiguration?: '2WD' | '4WD';
  emissionStage?: '国三' | '国四';
}

export interface LearningEntry {
  learningKind?: 'terminology';
  sourceUrl?: string;
  collection: 'learning';
  entryId: string;
  title: string;
  entryType: '通识学习';
  content: string;
  topic: string;
  status: string;
  knowledgePath: string;
  diagnosticEvidence: false;
}

export type LibraryEntry = LearningEntry | (CatalogEntry & {
  collection: 'archive';
  brand: string;
  models: string[];
});

export interface KnowledgeLibrary {
  collection: 'all' | 'archive' | 'learning';
  query: string;
  page: number;
  pageSize: number;
  total: number;
  entries: LibraryEntry[];
}

export interface KnowledgeCatalog {
  totals: {
    entries: number;
    archivedEntries: number;
    learningEntries: number;
    sources: number;
    brands: number;
    models: number;
    faultEntries: number;
    mappedEntries: number;
  };
  /** Knowledge-base release from the same immutable snapshot; null if metadata is unavailable. */
  kbVersion?: string | null;
  expansion: { targetLabel: '1w+'; countingUnit: 'indexed-entry'; status: 'planned' | 'reached' };
  brands: CatalogBrand[];
  selected?: CatalogSelection;
  library?: KnowledgeLibrary;
  limitations: string[];
  common?: CommonKnowledgeFramework;
}

export interface CatalogFilters {
  brand?: string;
  model?: string;
  component?: string;
  part?: string;
  symptom?: string;
  configuration?: 'CAB' | 'ROPS';
  driveConfiguration?: '2WD' | '4WD';
  emissionStage?: '国三' | '国四';
  collection?: KnowledgeLibrary['collection'];
  q?: string;
  page?: string;
  /** Library search: only entries tagged with this role. */
  role?: KnowledgeRole;
}

export const CATALOG_FILTER_KEYS = ['brand', 'model', 'component', 'part', 'symptom', 'configuration', 'driveConfiguration', 'emissionStage', 'collection', 'q', 'page', 'role'] as const;
export function validCatalogCondition(key: typeof CATALOG_FILTER_KEYS[number], value: string): boolean {
  if (key === 'configuration') return ['CAB', 'ROPS'].includes(value);
  if (key === 'driveConfiguration') return ['2WD', '4WD'].includes(value);
  if (key === 'emissionStage') return ['国三', '国四'].includes(value);
  if (key === 'collection') return ['all', 'archive', 'learning'].includes(value);
  if (key === 'role') return (KNOWLEDGE_ROLES as readonly string[]).includes(value);
  if (key === 'page') return /^[1-9]\d{0,5}$/.test(value);
  return true;
}

/** 3.5.10起来源品牌统一为主品牌，子品牌/产品线另存；旧标签筛选仍映射到主品牌。 */
export const LEGACY_BRAND_LABELS: Readonly<Record<string, string>> = {
  雷沃欧豹: '雷沃',
  雷沃阿波斯: '雷沃',
  '千寻位置 / 千耘': '千寻位置',
};

export function canonicalCatalogBrand(brand: string | undefined): string | undefined {
  return brand === undefined ? undefined : LEGACY_BRAND_LABELS[brand] ?? brand;
}
