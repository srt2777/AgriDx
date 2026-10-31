import type {
  CatalogBrand, CatalogComponent, CatalogCounts, CatalogEntry, CatalogFilters,
  CatalogModel, CatalogPart, KnowledgeCatalog,
  KnowledgeLibrary, KnowledgeOrganization, LearningEntry, LibraryEntry, LibraryKind, RoleCoverage, RiskCoverage,
} from '../../shared/knowledge-catalog';
import { canonicalCatalogBrand } from '../../shared/knowledge-catalog';
import type { ArchiveSource } from './archive';
import type { KnowledgeChunk } from './types';
import { buildCommonFramework, commonEntryIds, validateCommonDefinition } from './common';
import type { CommonFrameworkDefinition } from '../../shared/common-knowledge';

const INFORMATION_TYPES = new Set(['资料索引', '资料核验', '机型资料', '资料缺口', '系统适用边界']);

interface PartDefinition { id: string; name: string; evidence_terms: string[] }
interface ComponentDefinition { id: string; name: string; parts: PartDefinition[] }
interface EntryLink { component_id: string; part_ids: string[] }
interface HierarchyIndex {
  schema_version: number;
  components: ComponentDefinition[];
  entries: { entry_id: string; components: EntryLink[] }[];
}
interface SourceMetadata {
  source_id: string;
  model: string;
  document_type: string;
}
interface CatalogState {
  catalog: KnowledgeCatalog;
  chunks: KnowledgeChunk[];
  links: Map<string, EntryLink[]>;
  sources: Map<string, SourceMetadata>;
  commonDefinition: CommonFrameworkDefinition;
  library: { entry: LibraryEntry; searchable: string }[];
}

/** Group the existing records exactly once; no facts, causal edges or applicability are inferred. */
function organizeLibrary(archived: LibraryEntry[], learning: LearningEntry[]): KnowledgeOrganization {
  const counts: KnowledgeOrganization['counts'] = { archive: archived.length, general: 0, terminology: 0 };
  const archiveTypes = new Map<string, number>();
  const topics = new Map<string, { kind: 'general' | 'terminology'; name: string; count: number }>();
  for (const entry of archived) archiveTypes.set(entry.entryType, (archiveTypes.get(entry.entryType) ?? 0) + 1);
  for (const entry of learning) {
    const kind = entry.learningKind === 'terminology' ? 'terminology' : 'general';
    counts[kind]++;
    const key = JSON.stringify([kind, entry.topic]);
    const item = topics.get(key) ?? { kind, name: entry.topic, count: 0 };
    item.count++;
    topics.set(key, item);
  }
  return {
    counts,
    archiveTypes: [...archiveTypes].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    topics: [...topics.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'zh-CN')),
  };
}

function libraryKind(entry: LibraryEntry): LibraryKind {
  return entry.collection === 'archive' ? 'archive' : entry.learningKind === 'terminology' ? 'terminology' : 'general';
}

function roleCoverage(chunks: KnowledgeChunk[]): RoleCoverage {
  const result: RoleCoverage = { symptom: 0, cause: 0, check: 0, action: 0, retest: 0, tagged: 0, untagged: 0 };
  for (const chunk of new Map(chunks.map((c) => [c.entryId, c])).values()) {
    if (chunk.roles?.length) {
      result.tagged++;
      for (const role of chunk.roles) result[role]++;
    } else if (!INFORMATION_TYPES.has(chunk.entryType!)) result.untagged++;
  }
  return result;
}

function counts(chunks: KnowledgeChunk[]): CatalogCounts {
  const riskCoverage: RiskCoverage = { high: 0, medium: 0, low: 0, reviewed: 0, unreviewed: 0 };
  for (const chunk of new Map(chunks.map(chunk => [chunk.entryId, chunk])).values()) {
    if (INFORMATION_TYPES.has(chunk.entryType!) || chunk.diagnosticEvidence === false) continue;
    // Only archive metadata with a recorded basis counts. Runtime risk heuristics are not annotations.
    if (chunk.riskLevel && chunk.riskBasis?.trim()) {
      riskCoverage[chunk.riskLevel]++;
      riskCoverage.reviewed++;
    } else riskCoverage.unreviewed++;
  }
  return {
    roleCoverage: roleCoverage(chunks),
    riskCoverage,
    entryCount: new Set(chunks.map((chunk) => chunk.entryId)).size,
    faultCount: chunks.filter((chunk) => chunk.entryType === '维护/故障知识').length,
    sourceCount: new Set(chunks.map((chunk) => chunk.sourceId)).size,
    entryTypes: [...new Set(chunks.map((chunk) => chunk.entryType).filter((type): type is string => Boolean(type)))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  };
}

function modelScope(name: string): CatalogModel['scope'] {
  if (/待核实|未知/.test(name)) return 'pending';
  if (/系列|平台|拖拉机/.test(name)) return 'series';
  return 'exact';
}

function modelsOf(chunk: KnowledgeChunk, sources: Map<string, SourceMetadata>): string[] {
  // The archive loader already validates entry-specific configuration subsets.
  return chunk.models ?? [sources.get(chunk.sourceId!)!.model];
}

function includesLink(links: EntryLink[], component: string, part?: string): boolean {
  return links.some((link) => link.component_id === component && (!part || link.part_ids.includes(part)));
}

function validateHierarchy(index: HierarchyIndex, chunks: KnowledgeChunk[]): Map<string, EntryLink[]> {
  if (index.schema_version !== 1 || !Array.isArray(index.components) || !Array.isArray(index.entries)) {
    throw new Error('分层导航索引格式无效');
  }
  const components = new Map<string, ComponentDefinition>();
  for (const component of index.components) {
    if (!component.id || !component.name || !Array.isArray(component.parts) || components.has(component.id)) {
      throw new Error('分层导航组件定义无效或重复');
    }
    const ids = new Set<string>();
    for (const part of component.parts) {
      if (!part.id || !part.name || ids.has(part.id) || !part.evidence_terms?.length ||
        part.evidence_terms.some((term) => typeof term !== 'string' || !term.trim())) {
        throw new Error(`分层导航零件定义无效：${component.id}`);
      }
      ids.add(part.id);
    }
    components.set(component.id, component);
  }
  const byId = new Map(chunks.map((chunk) => [chunk.entryId!, chunk]));
  const links = new Map<string, EntryLink[]>();
  for (const record of index.entries) {
    const chunk = byId.get(record.entry_id);
    if (!chunk || links.has(record.entry_id) || !Array.isArray(record.components) || !record.components.length) {
      throw new Error(`分层导航条目无效或重复：${record.entry_id}`);
    }
    const seen = new Set<string>();
    for (const link of record.components) {
      const component = components.get(link.component_id);
      if (!component || seen.has(link.component_id) || !Array.isArray(link.part_ids) ||
        new Set(link.part_ids).size !== link.part_ids.length) {
        throw new Error(`分层导航组件关联无效：${record.entry_id}`);
      }
      seen.add(link.component_id);
      for (const partId of link.part_ids) {
        const part = component.parts.find((candidate) => candidate.id === partId);
        // Presence is necessary, not sufficient: these manually maintained links express
        // a lookup relation only, never a diagnosis or a confirmed damaged part.
        if (!part || !part.evidence_terms.some((term) => `${chunk.heading}\n${chunk.text}`.includes(term))) {
          throw new Error(`零件关联须在原知识段中有依据：${record.entry_id}/${partId}`);
        }
      }
    }
    links.set(record.entry_id, record.components);
  }
  for (const id of byId.keys()) {
    if (!links.has(id)) throw new Error(`新知识条目尚未维护分层导航：${id}`);
  }
  return links;
}

/** Pure catalog construction: consumes the archive already validated by the loader. */
export function buildKnowledgeCatalog(chunks: KnowledgeChunk[], sourceRecords: ArchiveSource[], hierarchy: unknown, commonData: unknown, learning: LearningEntry[] = []): (filters?: CatalogFilters) => KnowledgeCatalog {
  if (!hierarchy || typeof hierarchy !== 'object') throw new Error('分层导航索引格式无效');
  const index = hierarchy as HierarchyIndex;
  const links = validateHierarchy(index, chunks);
  const commonDefinition = validateCommonDefinition(commonData, chunks, index.entries, index.components.map(item => item.id));
  const sources = new Map<string, SourceMetadata>();
  for (const source of sourceRecords) {
    if (typeof source.model !== 'string' || !source.model.trim() || typeof source.document_type !== 'string' || !source.document_type.trim()) {
      throw new Error(`目录来源型号或资料类型缺失：${source.source_id}`);
    }
    sources.set(source.source_id, { source_id: source.source_id, model: source.model, document_type: source.document_type });
  }
  const brandNames = [...new Set(chunks.map((chunk) => chunk.brand!))];
  const brands: CatalogBrand[] = brandNames.sort((a, b) => a.localeCompare(b, 'zh-CN')).map((brand) => {
    const brandChunks = chunks.filter((chunk) => chunk.brand === brand);
    const modelNames = [...new Set(brandChunks.flatMap((chunk) => modelsOf(chunk, sources)))];
    const models: CatalogModel[] = modelNames.sort((a, b) => a.localeCompare(b, 'zh-CN')).map((model) => {
      const modelChunks = brandChunks.filter((chunk) => modelsOf(chunk, sources).includes(model));
      const navigation = modelChunks.every((chunk) => /配套|导航|辅助转向/.test(sources.get(chunk.sourceId!)!.document_type));
      const components: CatalogComponent[] = index.components
        .filter((definition) => navigation
          ? ['navigation', 'documents'].includes(definition.id)
          : definition.id !== 'navigation')
        .map((definition) => {
          const componentChunks = modelChunks.filter((chunk) => includesLink(links.get(chunk.entryId!)!, definition.id));
          const parts: CatalogPart[] = definition.parts.map((part) => {
            const partChunks = componentChunks.filter((chunk) => includesLink(links.get(chunk.entryId!)!, definition.id, part.id));
            return { id: part.id, name: part.name, ...counts(partChunks) };
          }).filter((part) => part.entryCount > 0);
          return {
            id: definition.id, name: definition.name, ...counts(componentChunks), parts,
            unresolvedPartCount: componentChunks.filter((chunk) =>
              links.get(chunk.entryId!)!.some((link) => link.component_id === definition.id && !link.part_ids.length)).length,
          };
        });
      return {
        id: model, name: model, scope: modelScope(model),
        machineType: navigation ? '配套导航系统' : modelScope(model) === 'pending' ? '待核实' : '拖拉机',
        ...counts(modelChunks), components,
      };
    });
    return { id: brand, name: brand, ...counts(brandChunks), models };
  });
  const catalog: KnowledgeCatalog = {
    totals: {
      entries: chunks.length + learning.length, archivedEntries: chunks.length, learningEntries: learning.length,
      sources: new Set(chunks.map((chunk) => chunk.sourceId)).size,
      brands: brands.length, models: brands.reduce((total, brand) => total + brand.models.length, 0),
      faultEntries: chunks.filter((chunk) => chunk.entryType === '维护/故障知识').length,
      mappedEntries: links.size,
    },
    expansion: { targetLabel: '1w+', countingUnit: 'indexed-entry', status: chunks.length + learning.length >= 10000 ? 'reached' : 'planned' },
    brands,
    common: buildCommonFramework(commonDefinition, chunks, 'archive'),
    limitations: [
      '知识总数为归档条目与通识学习条目之和；归档含资料索引、核验及缺口记录，尚未实现从零部件到整机的全部性能覆盖。',
      '型号名称按来源保留；系列、平台与待核实范围不代表完整型号。同册型号、别名及不同配置不视为互换。',
      '零件关联用于查找证据，故障表中的可能原因不等于确诊；维修、调整与停机策略须遵守对应版本和配置。',
      '条目数按已有索引去重；同条证据可关联多个组件和零件，分层计数不可相加。维护/故障类别也含维护条目。',
      '全部知识参与检索问答；通识资料用于原理解释与待验证分析，保留核验状态，不作为具体机型维修操作或参数的证据。',
      '1w+按可独立定位的索引条目累计；数量达到目标不代表独立故障种类、机型覆盖或实车验证程度。',
    ],
  };
  const archived: LibraryEntry[] = chunks.map(chunk => ({ ...asEntry(chunk), collection: 'archive',
    brand: chunk.brand!, models: modelsOf(chunk, sources) }));
  catalog.organization = organizeLibrary(archived, learning);
  // Interleave both collections so the common entrance immediately exposes both.
  const combined: LibraryEntry[] = [];
  for (let index = 0; index < Math.max(archived.length, learning.length); index++) {
    if (archived[index]) combined.push(archived[index]);
    if (learning[index]) combined.push(learning[index]);
  }
  const library = combined.map(entry => ({ entry, searchable: normalizeSearch([
    entry.entryId, entry.title, entry.entryType, entry.content,
    ...(entry.collection === 'archive' ? [entry.brand, ...entry.models, entry.sourceId] : [entry.topic]),
  ].join('\n')) }));
  const state = { catalog, chunks, links, sources, commonDefinition, library };
  return (filters = {}) => {
    const selected = selectKnowledgeCatalog(state, filters);
    return filters.collection || filters.kind || filters.topic || filters.entryType || filters.q || filters.page || filters.role
      ? { ...selected, library: selectLibrary(state, filters) } : selected;
  };
}

function normalizeSearch(value: string): string { return value.normalize('NFKC').toLocaleLowerCase(); }

function selectLibrary(state: CatalogState, filters: CatalogFilters): KnowledgeLibrary {
  const collection = filters.collection ?? 'all';
  const query = filters.q?.trim() ?? '';
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const matches = state.library.filter(({ entry, searchable }) =>
    (collection === 'all' || entry.collection === collection) &&
    (!filters.kind || libraryKind(entry) === filters.kind) &&
    (!filters.topic || (entry.collection === 'learning' && entry.topic === filters.topic)) &&
    (!filters.entryType || (entry.collection === 'archive' && entry.entryType === filters.entryType)) &&
    (!filters.role || (entry.collection === 'archive' && Boolean(entry.roles?.includes(filters.role)))) && terms.every(term => searchable.includes(term)));
  const pageSize = 20;
  const requested = Number(filters.page ?? '1');
  const page = Math.min(Number.isSafeInteger(requested) && requested > 0 ? requested : 1, Math.max(1, Math.ceil(matches.length / pageSize)));
  return { collection, query, page, pageSize, total: matches.length,
    entries: matches.slice((page - 1) * pageSize, page * pageSize).map(item => item.entry) };
}

function asEntry(chunk: KnowledgeChunk): CatalogEntry {
  return {
    entryId: chunk.entryId!, title: chunk.heading.split('｜').slice(1).join('｜'),
    entryType: chunk.entryType!, content: chunk.text, sourceId: chunk.sourceId!,
    sourceUrl: chunk.sourceUrl!, locator: chunk.locator!, version: chunk.version!,
    scopeBoundary: chunk.scopeBoundary!, status: chunk.status!, knowledgePath: chunk.source,
    ...(chunk.sourceTitle ? { sourceTitle: chunk.sourceTitle } : {}),
    ...(chunk.pages ? { pages: { ...chunk.pages } } : {}),
    ...(chunk.roles ? { roles: [...chunk.roles], roleBasis: chunk.roleBasis } : {}),
    ...(chunk.riskLevel ? { riskLevel: chunk.riskLevel } : {}),
    configuration: chunk.configuration, driveConfiguration: chunk.driveConfiguration, emissionStage: chunk.emissionStage,
  };
}

/** Exact strings identify archive nodes; an unknown model never falls back to a nearby model. */
function selectKnowledgeCatalog(current: CatalogState, requested: CatalogFilters): KnowledgeCatalog {
  const filters: CatalogFilters = requested.brand ? { ...requested, brand: canonicalCatalogBrand(requested.brand) } : requested;
  // An explicit condition requires matching metadata; unknown conditions stay a collection gap.
  const applicable = (chunk: KnowledgeChunk) =>
    (!filters.configuration || chunk.configuration === filters.configuration) &&
    (!filters.driveConfiguration || chunk.driveConfiguration === filters.driveConfiguration) &&
    (!filters.emissionStage || chunk.emissionStage === filters.emissionStage);
  const symptomIds = filters.symptom ? commonEntryIds(current.commonDefinition, filters.symptom) : undefined;
  if (!filters.model) return filters.symptom || filters.brand || filters.configuration || filters.driveConfiguration || filters.emissionStage ? {
    ...current.catalog,
    common: buildCommonFramework(current.commonDefinition,
      current.chunks.filter(x => (!filters.brand || x.brand === filters.brand) && applicable(x)), 'archive', filters.symptom),
  } : current.catalog;
  const brand = current.catalog.brands.find((item) => item.name === filters.brand);
  const model = brand?.models.find((item) => item.name === filters.model);
  if (!brand || !model) throw new RangeError('该品牌和型号没有归档资料，请按目录选择并核对完整型号。');
  const component = filters.component ? model.components.find((item) => item.id === filters.component) : undefined;
  if (filters.component && !component) throw new RangeError('组件不属于所选资料目录。');
  if (filters.part && !component?.parts.some((part) => part.id === filters.part)) {
    throw new RangeError('零部件没有该型号的关联证据，请重新选择。');
  }
  const selectedChunks = current.chunks.filter((chunk) => applicable(chunk) && chunk.brand === brand.name &&
    modelsOf(chunk, current.sources).includes(model.name) && (!filters.component ||
      includesLink(current.links.get(chunk.entryId!)!, filters.component, filters.part)));
  const symptomChunks = selectedChunks.filter(chunk => !symptomIds || symptomIds.has(chunk.entryId!));
  const missing = model.components.filter((item) => !['documents', 'machine'].includes(item.id) && item.faultCount === 0);
  const gaps = [
    ...missing.map((item) => `${item.name}：当前没有归档的维护/故障类别条目，待补匹配资料。`),
    ...(model.scope !== 'exact' ? ['本目录仅有系列、平台或待核实范围，须确认完整型号后才可用作本机维修依据。'] : []),
    ...(selectedChunks.length && selectedChunks.every((chunk) => INFORMATION_TYPES.has(chunk.entryType!))
      ? ['当前选择仅有资料范围、核验或背景信息，不提供对应维修事实。'] : []),
    ...(component?.unresolvedPartCount ? ['部分证据只定位到组件，具体零件尚待核实；未补造件号或兼容性。'] : []),
    ...(!selectedChunks.length ? ['当前选择没有归档条目；不得据此判断机器正常或生成维修策略。'] : []),
    ...(symptomIds && !symptomChunks.length ? ['该运行表现暂无本目录的关联证据；通用分类不提供其他机型的维修策略。'] : []),
    ...(filters.configuration || filters.driveConfiguration || filters.emissionStage
      ? ['已按明确的配置/驱动/排放元数据筛选；未登记这些条件的条目保留待核实，未作为匹配证据返回。'] : []),
  ];
  return {
    ...current.catalog,
    common: buildCommonFramework(current.commonDefinition, selectedChunks, 'model', filters.symptom),
    selected: {
      brand: brand.name, model: model.name, component: filters.component, part: filters.part,
      entries: symptomChunks.map(asEntry), gaps,
      configuration: filters.configuration, driveConfiguration: filters.driveConfiguration, emissionStage: filters.emissionStage,
    },
  };
}
