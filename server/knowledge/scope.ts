import type { KnowledgeChunk } from './retriever';

export interface RetrievalContext {
  machineType?: string;
  brand?: string;
  model?: string;
  engineModel?: string;
  faultCodes?: string[];
}

const BRAND_ALIASES: Record<string, string[]> = {
  久保田: ['久保田', 'kubota'],
  纽荷兰: ['纽荷兰', 'new holland', 'newholland'],
  Mahindra: ['mahindra'],
  中联: ['中联', 'zoomlion'],
  雷沃: ['雷沃', 'lovol', '福田雷沃', '雷沃欧豹', '雷沃阿波斯'],
  东风: ['东风', 'dongfeng', 'dong feng'],
  鸿鹄: ['鸿鹄', '国科鸿鹄', 'honghu'],
  东方红: ['东方红', 'yto'],
  常发: ['常发', 'changfa'],
  沃得: ['沃得', '悍沃'],
  黄海金马: ['黄海金马', '金马', 'jinma'],
  时风: ['时风', 'shifeng'],
  潍泰: ['潍泰', 'weitai'],
  约翰迪尔: ['约翰迪尔', 'john deere', 'johndeere'],
  '千寻位置 / 千耘': ['千寻位置', '千耘', 'qianxun'],
  华测: ['华测', 'chcnav', '华测导航', 'huace'],
};

let indexedManualNumbers: string[] = [];
let indexedReferenceIds = new Set<string>();

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** References identify documents, not the equipment being diagnosed. Keep scan offsets intact. */
function withoutReferences(text: string): string {
  let clean = text.replace(/\[[^\]\r\n]*\]\((?:https?:\/\/|\/)[^)\r\n]*\)|https?:\/\/[^\s<>，；。！？、：,;!:]+?\.(?:pdf|md)(?=\.[\u4e00-\u9fff])|https?:\/\/[^\s<>，；。！？、：,;!:]+|\b(?:SRC|KB|NH|ZL|LV|DF|HH)-[A-Z0-9-]+\b|(?:\/|知识库\/|server\/)[^\s<>，；。！？、：,;:!]+?\.(?:pdf|md)\b|(?<![a-z0-9])[a-z0-9][a-z0-9_.-]*?\.(?:pdf|md)\b/gi,
    (reference) => ' '.repeat(reference.length));
  // New collection ID prefixes are index references, not machine identities.
  // Only registered complete IDs are removed; similar unknown models remain visible.
  clean = clean.replace(/(?<![a-z0-9_-])[a-z0-9]+(?:-[a-z0-9]+)+(?![a-z0-9_-])/gi,
    (reference) => indexedReferenceIds.has(reference.toUpperCase()) ? ' '.repeat(reference.length) : reference);
  for (const number of indexedManualNumbers) {
    clean = clean.replace(new RegExp(`(?<![a-z0-9])${escapeRegex(number)}(?![a-z0-9.-])`, 'gi'),
      (reference) => ' '.repeat(reference.length));
  }
  return clean;
}

function brandsIn(text: string): string[] {
  const lower = withoutReferences(text).toLowerCase();
  return Object.entries(BRAND_ALIASES).filter(([, aliases]) => aliases.some((alias) => {
    if (/^[a-z ]+$/.test(alias)) return new RegExp(`(^|[^a-z])${alias.replace(/ /g, '\\s*')}([^a-z]|$)`).test(lower);
    return lower.includes(alias);
  })).map(([brand]) => brand);
}

function canonicalBrand(brand: string | undefined): string | undefined {
  if (!brand) return undefined;
  const known = brandsIn(brand);
  return known.length === 1 ? known[0] : brand.toLowerCase();
}

function normalizeModel(model: string): string {
  return model.toLowerCase().replace(/欧豹|系列|平台|拖拉机/g, '').replace(/[\s\-_/()（）]/g, '');
}

/** Only Chinese national-emission labels are aliases; Tier/Stage IV is a separate standard. */
function normalizeNationalEmissions(text: string): string {
  return text.replace(/国\s*(三|3|iii|Ⅲ|四|4|iv|Ⅳ)(?![a-z0-9])/gi, (_label, stage: string) =>
    ['三', '3', 'iii'].includes(stage.normalize('NFKC').toLowerCase()) ? '国三' : '国四',
  );
}

/** Explicit lists and parenthetical product names are aliases, never inferred submodels. */
function declaredModels(chunk: KnowledgeChunk): string[] {
  if (chunk.models?.length) return chunk.models.map(normalizeModel);
  const model = chunk.model || '';
  if (model === 'QYBD-2.5SD（QY210 Pro）') return ['qybd2.5sd', 'qy210pro'];
  return model.split(/[/、,，]|-(?=lx)/i).map(normalizeModel);
}

let indexedModels: string[] = [];
let modelFamilies: string[] = ['workmaster', 'lx', 't', 'pl', 'tg'];

/** Rebuilt on reload so source model lists drive recognition as the archive grows. */
export function configureIndexedModels(chunks: KnowledgeChunk[]): void {
  indexedReferenceIds = new Set(chunks.flatMap((chunk) => [chunk.entryId, chunk.sourceId])
    .filter((id): id is string => Boolean(id)));
  // Only registered manual numbers are references; dotted model suffixes remain identities.
  indexedManualNumbers = [...new Set(chunks.flatMap((chunk) =>
    chunk.version?.match(/\bSM-[A-Z0-9]+(?:[.-][A-Z0-9]+)+\b/gi) ?? [],
  ))];
  indexedModels = [...new Set(chunks.flatMap(declaredModels))]
    .filter((model) => /^[a-z0-9.]+$/.test(model)).sort((a, b) => b.length - a.length);
  modelFamilies = [...new Set([
    'workmaster', 'lx', 't', 'pl', 'tg',
    ...indexedModels.flatMap((model) => {
      const prefix = model.match(/^(?:\d+[a-z]+|[a-z]+)(?=\d)/)?.[0];
      return prefix ? [prefix] : /^[a-z]{1,5}$/.test(model) ? [model] : [];
    }),
  ])].sort((a, b) => b.length - a.length);
}

interface ModelMention {
  start: number;
  end: number;
  model: string;
}

function modelMentions(text: string): ModelMention[] {
  // Preserve the existing LX2620-LX2620SU grouped alias without merging two identities.
  const scanText = withoutReferences(text).replace(/-(?=lx\s*\d)/gi, '/')
    .replace(/((?:故障码|错误码|报警码|报码|\b(?:fault|error)\s+code\b)\s*[:：=]?\s*)([a-z]+\d[a-z0-9]*(?:[.-][a-z0-9]+)*)/gi,
      (_match, label: string, code: string) => label + ' '.repeat(code.length));
  const mentions: ModelMention[] = [];
  for (const model of indexedModels) {
    const pattern = [...model].map(escapeRegex).join('[\\s\\-_/()（）]*');
    const regex = new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`, 'gi');
    for (const match of scanText.matchAll(regex)) {
      mentions.push({ start: match.index!, end: match.index! + match[0].length, model });
    }
  }
  // Unknown models in indexed families remain identities, preventing a generic fallback.
  const families = modelFamilies.map(escapeRegex).join('|');
  const regex = new RegExp(`(?<![a-z0-9])(?:${families})[\\s-]*\\d[a-z0-9]*(?:[.-]\\s*[a-z0-9]+)*(?:\\s+(?:pro|su))?(?:\\s*[(（]\\s*g\\d+\\s*[)）])?`, 'gi');
  for (const match of scanText.matchAll(regex)) {
    mentions.push({ start: match.index!, end: match.index! + match[0].length, model: normalizeModel(match[0]) });
  }
  // Unknown families require a recognized brand or an explicit model label, never a bare number.
  const candidate = '(?:[a-z]+|\\d+[a-z]+)[\\s-]*\\d[a-z0-9]*(?:[.-]\\s*[a-z0-9]+)*(?:\\s+(?:pro|su))?(?:\\s*[(（]\\s*g\\d+\\s*[)）])?';
  const aliases = Object.values(BRAND_ALIASES).flat().sort((a, b) => b.length - a.length)
    .map((alias) => /^[a-z ]+$/.test(alias)
      ? `(?<![a-z])${alias.replace(/ /g, '\\s*')}(?![a-z])` : escapeRegex(alias)).join('|');
  for (const pattern of [
    new RegExp(`(?:${aliases})[\\s:：-]*(${candidate})(?![a-z0-9])`, 'gi'),
    new RegExp(`(?:型号|机型)\\s*[:：=]?\\s*(?:为|是)?\\s*(${candidate})(?![a-z0-9])`, 'gi'),
  ]) {
    for (const match of scanText.matchAll(pattern)) {
      const model = normalizeModel(match[1]);
      if (/^err\d/.test(model)) continue;
      const start = match.index! + match[0].length - match[1].length;
      mentions.push({ start, end: start + match[1].length, model });
    }
  }
  // A longer identity always wins: WORKMASTER25S must not be read as WORKMASTER25.
  const sorted = mentions.sort((a, b) => a.start - b.start || b.end - a.end);
  return sorted.filter((mention, index) => !sorted.slice(0, index).some((previous) =>
    previous.start <= mention.start && previous.end >= mention.end,
  ));
}

function modelsIn(text: string): string[] {
  text = normalizeNationalEmissions(text);
  const models = modelMentions(text).map((mention) => mention.model);
  if (text.includes('国三')) models.push('国三');
  if (text.includes('国四') && !models.some((model) => model.endsWith('g4'))) models.push('国四');
  return [...new Set(models)];
}

/** Identity selects eligible documents without inflating their symptom relevance. */
export function queryWithoutIdentity(query: string): string {
  let text = normalizeNationalEmissions(withoutReferences(query));
  for (const aliases of Object.values(BRAND_ALIASES)) {
    for (const alias of [...aliases].sort((a, b) => b.length - a.length)) {
      text = /^[a-z ]+$/.test(alias)
        ? text.replace(new RegExp(`(^|[^a-z])${alias.replace(/ /g, '\\s*')}(?=[^a-z]|$)`, 'gi'), '$1 ')
        : text.replaceAll(alias, ' ');
    }
  }
  for (const mention of modelMentions(text).sort((a, b) => b.start - a.start)) {
    text = text.slice(0, mention.start) + ' ' + text.slice(mention.end);
  }
  return text.replace(/欧豹|系列|平台|国三|国四/g, ' ');
}

export interface ResolvedScope {
  brand?: string;
  models: string[];
  emissions: string[];
  configurations: ('CAB' | 'ROPS')[];
  driveConfigurations: ('2WD' | '4WD')[];
  ambiguous: boolean;
  identityConflict: boolean;
  tractorArchive: boolean;
  genericKnowledge: boolean;
  electric: boolean;
}

export function resolveScope(query: string, context: RetrievalContext): ResolvedScope {
  const queryIdentity = withoutReferences(query);
  const queryBrands = brandsIn(queryIdentity);
  const explicitBrand = context.brand?.trim();
  const contextBrands = brandsIn(explicitBrand || '');
  const brand = explicitBrand ? canonicalBrand(explicitBrand) : queryBrands.length === 1 ? queryBrands[0] : undefined;
  const explicitModel = context.model?.trim();
  // Remove only recognized emission labels; undocumented model suffixes remain distinct identities.
  const contextModels = explicitModel ? declaredModels({ source: '', heading: '', text: '',
    model: normalizeNationalEmissions(explicitModel).replace(/国三|国四/g, ''),
  }).filter(Boolean) : [];
  const queryModels = modelsIn(queryIdentity);
  const models = contextModels.length ? contextModels : queryModels;
  // This pair is an explicitly documented product alias, not a shared-manual model range.
  const modelIdentity = (model: string) => model === 'qy210pro' ? 'qybd2.5sd' : model;
  const contextIdentities = new Set(contextModels.map(modelIdentity));
  const modelConflict = contextIdentities.size > 0 && queryModels
    .filter((model) => model !== '国三' && model !== '国四')
    .some((model) => !contextIdentities.has(modelIdentity(model)));
  const brandConflict = Boolean(explicitBrand && queryBrands.some((queryBrand) => queryBrand !== brand));
  const emissionText = normalizeNationalEmissions([queryIdentity, explicitModel].filter(Boolean).join(' '));
  const emissions = ['国三', '国四'].filter((stage) => emissionText.includes(stage));
  const configurationText = [queryIdentity, explicitModel].filter(Boolean).join(' ');
  const configurations: ('CAB' | 'ROPS')[] = [];
  if (/\bcab\b|驾驶室/i.test(configurationText)) configurations.push('CAB');
  if (/\brops\b|防翻架|防翻滚架/i.test(configurationText)) configurations.push('ROPS');
  const driveConfigurations: ('2WD' | '4WD')[] = [];
  if (/\b2wd\b|两驱|二驱|两轮驱动|二轮驱动/i.test(configurationText)) driveConfigurations.push('2WD');
  if (/\b4wd\b|四驱|四轮驱动/i.test(configurationText)) driveConfigurations.push('4WD');
  const type = context.machineType?.trim();
  const tractorContext = Boolean(type && /^(拖拉机|tractor|新能源农机|new-energy|无人农机|autonomous)$/i.test(type));
  const nonTractor = /收割机|插秧机|植保机|播种机|无人机|\b(combine|transplanter|sprayer)\b/i;
  const nonTractorQuery = nonTractor.test(queryIdentity);
  const tractorArchive = type ? tractorContext : !nonTractorQuery;
  // Clearly attached implements are not a change of the machine being discussed.
  const queryTypeIdentity = queryIdentity.replace(/(?:挂接|连接|牵引|\bPTO\s*接)\s*(?:的\s*)?(?:收割机|插秧机|植保机|播种机|无人机|combine|transplanter|sprayer)/gi, ' ');
  const typeConflict = Boolean(type && (tractorContext ? nonTractor.test(queryTypeIdentity)
    : nonTractor.test(type) && /拖拉机|\btractor\b/i.test(queryTypeIdentity)));
  const identityConflict = brandConflict || modelConflict || typeConflict;
  // Powered hand tools do not identify the tractor's propulsion system.
  const queryPowerIdentity = queryIdentity.replace(/电动(?:工具|扳手|螺丝刀)|\belectric\s+(?:tools?|wrenches?|screwdrivers?)\b/gi, ' ')
    // Manual steering becoming unavailable does not identify an autonomous tractor.
    .replace(/无人力转向/g, '人力转向');
  const electric = /电动|新能源|无人|electric|autonomous|new-energy/i.test([type, explicitBrand, context.model, queryPowerIdentity].filter(Boolean).join(' ')) ||
    brand === '鸿鹄' || models.includes('t70');
  const ambiguous = queryBrands.length > 1 || contextBrands.length > 1;
  return { brand, models, emissions, configurations, driveConfigurations, ambiguous, identityConflict, tractorArchive, electric, genericKnowledge: tractorArchive && !identityConflict && !electric && !brand && models.length === 0 && emissions.length === 0 && !ambiguous };
}

/** Matching is identity selection, not proof of market, configuration or version applicability. */
export function archiveApplicability(chunk: KnowledgeChunk, scope: ResolvedScope): 'matched' | 'pending' | undefined {
  const brand = canonicalBrand(chunk.brand);
  if (!scope.tractorArchive || scope.ambiguous || scope.identityConflict || (scope.brand && scope.brand !== brand)) return undefined;
  if (scope.electric && brand !== '鸿鹄' && brand !== '千寻位置 / 千耘') return undefined;
  if (chunk.configuration && scope.configurations.some((configuration) => configuration !== chunk.configuration)) return undefined;
  if (chunk.driveConfiguration && scope.driveConfigurations.some((configuration) => configuration !== chunk.driveConfiguration)) return undefined;
  const allowed = declaredModels(chunk);
  const emissionStage = chunk.emissionStage ?? (chunk.emissionStageUnknown ? undefined
    : chunk.model === '国三拖拉机' ? '国三'
      : allowed.length > 0 && allowed.every((model) => model.endsWith('g4')) ? '国四' : undefined);
  if (scope.emissions.some((stage) => stage !== emissionStage)) return undefined;
  const models = scope.models.filter((model) => model !== '国三' && model !== '国四');
  if (models.length === 0) return !chunk.requiresExactModel && scope.brand === brand ? 'pending' : undefined;

  if (chunk.model === '具体系列待核实') return scope.brand === brand ? 'pending' : undefined;
  if (chunk.model === '国三拖拉机' && scope.brand !== brand) return undefined;
  if (!models.every((model) => allowed.includes(model))) return undefined;
  return models.some((model) => /\d/.test(model)) ? 'matched' : 'pending';
}
