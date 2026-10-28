import fs from 'node:fs';
import path from 'node:path';
import type { KnowledgeChunk } from './types';
import { configureIndexedModels } from './scope';
import { isArchiveId } from './evidence';

const ARCHIVE_ROOT = path.resolve(process.cwd(), '知识库/整理后的知识库');
const ENTRY_TYPES = ['维护/故障知识', '操作/维护知识', '安全操作', '系统安装/调试',
  '系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口'];
/** Optional role/risk schema (2026-10-21); absent means not yet tagged, never "none" or "low". */
export const ENTRY_ROLES = ['symptom', 'cause', 'check', 'action', 'retest'] as const;
export type EntryRole = typeof ENTRY_ROLES[number];
const ROLE_BASES = ['原文标记', '人工核对'];
const RISK_LEVELS = ['high', 'medium', 'low'];
const NON_DIAGNOSTIC_ENTRY_TYPES = ['系统适用边界', '资料索引', '资料核验', '机型资料', '资料缺口'];

export interface ArchiveEntry {
  entry_id: string;
  source_id: string;
  brand: string;
  model: string;
  models?: string[];
  /** Entry-specific, reviewed applicability. Never infer from titles or inherit a manual-wide code list. */
  engine_model?: string;
  fault_codes?: string[];
  configuration?: 'CAB' | 'ROPS';
  drive_configuration?: '2WD' | '4WD';
  title: string;
  knowledge_path: string;
  locator: string;
  status: string;
  scope_boundary?: string;
  use?: string;
  entry_type?: string;
  emission_stage?: '国三' | '国四';
  roles?: EntryRole[];
  role_basis?: '原文标记' | '人工核对';
  risk_level?: 'high' | 'medium' | 'low';
  risk_basis?: string;
}

/** Mirrors 校验索引.py check_roles structure; the validator also checks explicit Markdown markers. */
export function entryRoleSchemaError(entry: ArchiveEntry): string | undefined {
  const tagged = ['roles', 'role_basis', 'risk_level', 'risk_basis'].some((field) => field in entry);
  if (!tagged) return undefined;
  if (NON_DIAGNOSTIC_ENTRY_TYPES.includes(entry.entry_type ?? '')) return '资料信息类条目不标注角色或风险等级';
  if (entry.roles !== undefined || entry.role_basis !== undefined) {
    const roles = entry.roles;
    if (!Array.isArray(roles) || !roles.length || new Set(roles).size !== roles.length ||
      roles.some((role, index) => !ENTRY_ROLES.includes(role) ||
        (index > 0 && ENTRY_ROLES.indexOf(role) < ENTRY_ROLES.indexOf(roles[index - 1])))) {
      return 'roles须为symptom/cause/check/action/retest的非空、无重复有序子集';
    }
    if (!ROLE_BASES.includes(entry.role_basis ?? '')) return 'roles须同时填写role_basis';
  }
  if (entry.risk_level !== undefined || entry.risk_basis !== undefined) {
    if (!RISK_LEVELS.includes(entry.risk_level ?? '')) return 'risk_level只能为high、medium或low';
    if (typeof entry.risk_basis !== 'string' || !entry.risk_basis.trim()) return 'risk_level须同时填写risk_basis';
  }
  return undefined;
}

const SIDECAR_FIELDS = new Set(['entry_id', 'roles', 'role_basis', 'risk_level', 'risk_basis']);
type RoleFields = Pick<ArchiveEntry, 'roles' | 'role_basis' | 'risk_level' | 'risk_basis'>;

/** entry-roles.jsonl (2026-10-22 sidecar): reviewed roles only; the AI review queue is never loaded. */
export function loadRoleSidecar(indexRoot: string): Map<string, RoleFields> {
  const file = path.join(indexRoot, 'entry-roles.jsonl');
  const result = new Map<string, RoleFields>();
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return result;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record: unknown = JSON.parse(line);
    if (!record || typeof record !== 'object') throw new Error('entry-roles.jsonl行必须是对象');
    const { entry_id: id, ...fields } = record as { entry_id?: unknown } & RoleFields;
    if (typeof id !== 'string' || !isArchiveId(id)) throw new Error('entry-roles.jsonl条目编号无效');
    if (Object.keys(record).some((key) => !SIDECAR_FIELDS.has(key))) throw new Error(`entry-roles.jsonl含未知字段：${id}`);
    if (result.has(id)) throw new Error(`entry-roles.jsonl条目编号重复：${id}`);
    result.set(id, fields);
  }
  return result;
}

/** Page numbers exactly as written in the locator; absent when the locator gives none. */
export function parsePages(locator: string): { pdf?: string; printed?: string } | undefined {
  const pdf = locator.match(/PDF\s*(?:物理)?\s*第?\s*(\d[\d、，,～~\-–\s]*?)\s*页/)?.[1]?.trim();
  const printed = locator.match(/印刷(?:页码)?\s*第?\s*(\d[\d、，,～~\-–]*)/)?.[1]?.trim();
  return pdf || printed ? { ...(pdf ? { pdf } : {}), ...(printed ? { printed } : {}) } : undefined;
}

export interface ArchiveSource {
  brand?: string;
  sub_brand?: string;
  product_line?: string;
  brand_label?: string;
  title?: string;
  title_status?: '已核对' | '待核实';
  model_ids?: string[];
  model?: string;
  document_type?: string;
  source_id: string;
  path: string;
  url: string;
  version: string;
  scope_boundary: string;
  models?: string[];
  configuration?: 'CAB' | 'ROPS';
  drive_configuration?: '2WD' | '4WD';
  emission_stage?: '国三' | '国四';
  emission_stage_unknown?: boolean;
}

function requireStrings(value: unknown, fields: string[], label: string): void {
  if (!value || typeof value !== 'object' || fields.some((field) =>
    typeof (value as Record<string, unknown>)[field] !== 'string' ||
    !(value as Record<string, string>)[field].trim(),
  )) throw new Error(`知识索引字段缺失：${label}`);
}

/** Only indexed entry sections are loaded; raw manuals, READMEs and pending lists are excluded. */
export function loadArchive(archiveRoot = ARCHIVE_ROOT, options: { configureModels?: boolean } = {}): { chunks: KnowledgeChunk[]; fileCount: number; sources: ArchiveSource[] } {
  const INDEX_ROOT = path.join(archiveRoot, '农用拖拉机知识库');
  const sources: unknown = JSON.parse(fs.readFileSync(path.join(INDEX_ROOT, 'sources.json'), 'utf8'));
  if (!Array.isArray(sources)) throw new Error('sources.json 必须是数组');
  const sourceMap = new Map<string, ArchiveSource>();
  for (const value of sources) {
    requireStrings(value, ['source_id', 'path', 'url', 'version', 'scope_boundary'], 'sources.json');
    const source = value as ArchiveSource;
    if (!isArchiveId(source.source_id)) throw new Error(`来源编号无效：${source.source_id}`);
    if (source.models !== undefined && (!Array.isArray(source.models) || !source.models.length ||
      source.models.some((model) => typeof model !== 'string' || !model.trim()))) {
      throw new Error(`知识来源机型列表无效：${source.source_id}`);
    }
    if (source.emission_stage !== undefined && !['国三', '国四'].includes(source.emission_stage)) {
      throw new Error(`知识来源排放阶段无效：${source.source_id}`);
    }
    if (source.emission_stage_unknown !== undefined && (typeof source.emission_stage_unknown !== 'boolean' ||
      source.emission_stage_unknown && source.emission_stage !== undefined)) {
      throw new Error(`知识来源未知排放标记无效或与明确阶段冲突：${source.source_id}`);
    }
    if (source.configuration !== undefined && !['CAB', 'ROPS'].includes(source.configuration)) {
      throw new Error(`知识来源配置无效：${source.source_id}`);
    }
    if (source.drive_configuration !== undefined && !['2WD', '4WD'].includes(source.drive_configuration)) {
      throw new Error(`知识来源驱动配置无效：${source.source_id}`);
    }
    if (sourceMap.has(source.source_id)) throw new Error(`来源编号重复：${source.source_id}`);
    sourceMap.set(source.source_id, source);
  }

  const sidecar = loadRoleSidecar(INDEX_ROOT);
  const documents = new Map<string, Map<string, { heading: string; text: string }>>();
  const chunks: KnowledgeChunk[] = [];
  const ids = new Set<string>();
  const lines = fs.readFileSync(path.join(INDEX_ROOT, 'entries.jsonl'), 'utf8').split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    const value: unknown = JSON.parse(line);
    requireStrings(value, ['entry_id', 'source_id', 'brand', 'model', 'title', 'knowledge_path', 'locator', 'status', 'entry_type'], 'entries.jsonl');
    const entry = value as ArchiveEntry;
    const tagged = sidecar.get((entry as { entry_id?: string }).entry_id ?? '');
    if (tagged) {
      const clash = Object.keys(tagged).filter((key) => key in entry);
      if (clash.length) throw new Error(`entry-roles.jsonl与entries.jsonl重复填写：${entry.entry_id}`);
      Object.assign(entry, tagged);
    }
    if (!isArchiveId(entry.entry_id) || !isArchiveId(entry.source_id)) throw new Error(`知识条目编号无效：${entry.entry_id}`);
    if (!ENTRY_TYPES.includes(entry.entry_type!)) throw new Error(`知识条目类别无效：${entry.entry_id}`);
    if (entry.emission_stage !== undefined && !['国三', '国四'].includes(entry.emission_stage)) {
      throw new Error(`知识条目排放阶段无效：${entry.entry_id}`);
    }
    if (entry.engine_model !== undefined && (typeof entry.engine_model !== 'string' || !entry.engine_model.trim() ||
      entry.engine_model !== entry.engine_model.trim() || entry.engine_model.length > 120 || /[\r\n\0]/.test(entry.engine_model))) {
      throw new Error(`知识条目发动机适配字段无效：${entry.entry_id}`);
    }
    if (entry.fault_codes !== undefined && (!Array.isArray(entry.fault_codes) || !entry.fault_codes.length || entry.fault_codes.length > 1000 ||
      entry.fault_codes.some(code => typeof code !== 'string' || !code.trim() || code !== code.trim() || code.length > 120 || /[\r\n\0]/.test(code)) ||
      new Set(entry.fault_codes).size !== entry.fault_codes.length)) {
      throw new Error(`知识条目故障码适配字段无效：${entry.entry_id}`);
    }
    const roleError = entryRoleSchemaError(entry);
    if (roleError) throw new Error(`知识条目角色/风险字段无效：${entry.entry_id}：${roleError}`);
    if (ids.has(entry.entry_id)) throw new Error(`知识条目编号重复：${entry.entry_id}`);
    ids.add(entry.entry_id);
    const source = sourceMap.get(entry.source_id);
    if (!source) throw new Error(`知识条目来源不存在：${entry.entry_id}`);
    if (source.brand !== undefined && entry.brand !== source.brand && entry.brand !== source.brand_label) {
      throw new Error(`知识条目品牌须与来源主品牌或原标签一致：${entry.entry_id}`);
    }
    if (entry.models !== undefined && (!Array.isArray(entry.models) || !entry.models.length ||
      entry.models.some((model) => typeof model !== 'string' || !model.trim() || !source.models?.includes(model)) ||
      new Set(entry.models).size !== entry.models.length)) {
      throw new Error(`知识条目机型须为来源明确型号的非空子集：${entry.entry_id}`);
    }
    if (entry.configuration !== undefined && (!['CAB', 'ROPS'].includes(entry.configuration) ||
      (source.configuration !== undefined && entry.configuration !== source.configuration))) {
      throw new Error(`知识条目配置无效或与来源冲突：${entry.entry_id}`);
    }
    if (entry.drive_configuration !== undefined && (!['2WD', '4WD'].includes(entry.drive_configuration) ||
      (source.drive_configuration !== undefined && entry.drive_configuration !== source.drive_configuration))) {
      throw new Error(`知识条目驱动配置无效或与来源冲突：${entry.entry_id}`);
    }

    const file = path.resolve(process.cwd(), entry.knowledge_path);
    const relative = path.relative(archiveRoot, file);
    const realRelative = path.relative(fs.realpathSync(archiveRoot), fs.realpathSync(file));
    if ([relative, realRelative].some((rel) => rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)) || !file.endsWith('.md')) {
      throw new Error(`知识文档必须位于整理后的知识库内：${entry.entry_id}`);
    }
    let sections = documents.get(file);
    if (!sections) {
      sections = new Map();
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/^##\s+([^\r\n]+)\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/gm)) {
        const heading = match[1].trim();
        const key = heading.split('｜')[0].trim();
        if (sections.has(key)) throw new Error(`知识章节重复：${key}`);
        sections.set(key, { heading, text: match[2].trim() });
      }
      documents.set(file, sections);
    }
    const section = sections.get(entry.entry_id);
    if (!section?.text) throw new Error(`索引对应的知识章节缺失：${entry.entry_id}`);
    // Inherited market/configuration limits in the manual's introduction apply to every entry.
    const inheritedScope = sections.get('来源与适用范围')?.text.split('\n')
      .filter((line) => /^- (仅适用|型号：|适用：|资料性质：|整理日期：)/.test(line)).join('\n');
    chunks.push({
      source: entry.knowledge_path.replace(/\\/g, '/'),
      heading: section.heading,
      text: section.text,
      entryId: entry.entry_id,
      sourceId: entry.source_id,
      indexedReference: Object.freeze({ entryId: entry.entry_id, sourceId: entry.source_id }),
      // 条目保留历史品牌标签以维持既有批次字节基线；检索与目录统一使用来源主品牌。
      brand: source.brand ?? entry.brand,
      model: entry.model,
      models: entry.models ? [...entry.models] : source.models ? [...source.models] : undefined,
      requiresExactModel: entry.models !== undefined,
      ...(entry.engine_model !== undefined ? { engineModel: entry.engine_model } : {}),
      ...(entry.fault_codes !== undefined ? { faultCodes: [...entry.fault_codes] } : {}),
      configuration: entry.configuration ?? source.configuration,
      driveConfiguration: entry.drive_configuration ?? source.drive_configuration,
      emissionStage: entry.emission_stage ?? source.emission_stage,
      emissionStageUnknown: source.emission_stage_unknown,
      sourceUrl: source.url,
      originalPath: source.path,
      locator: entry.locator,
      version: source.version,
      scopeBoundary: [source.scope_boundary, inheritedScope, entry.scope_boundary, entry.use].filter(Boolean).join('\n'),
      status: entry.status,
      entryType: entry.entry_type,
      sourceTitle: source.title,
      pages: parsePages(entry.locator),
      ...(entry.roles ? { roles: [...entry.roles], roleBasis: entry.role_basis } : {}),
      ...(entry.risk_level ? { riskLevel: entry.risk_level, riskBasis: entry.risk_basis } : {}),
    });
  }
  for (const id of sidecar.keys()) if (!ids.has(id)) throw new Error(`entry-roles.jsonl引用的条目不存在：${id}`);
  if (options.configureModels !== false) configureIndexedModels(chunks);
  return { chunks, fileCount: documents.size, sources: [...sourceMap.values()] };
}

