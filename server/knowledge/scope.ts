import { displayFaultCodePattern, threeFieldFaultCodePattern } from './fault-codes';
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
  奔野: ['奔野', 'benye'],
  黄海金马: ['黄海金马', '金马', 'jinma'],
  时风: ['时风', 'shifeng'],
  潍泰: ['潍泰', 'weitai'],
  五征: ['五征', '山拖'],
  玉柴: ['玉柴', 'yuchai'],
  约翰迪尔: ['约翰迪尔', 'john deere', 'johndeere'],
  ISEKI: ['井关', 'iseki'],
  Belarus: ['belarus', 'беларус'],
  千寻位置: ['千寻位置', '千耘', 'qianxun', '千寻位置 / 千耘'],
  华测: ['华测', 'chcnav', '华测导航', 'huace'],
};

let indexedManualNumbers: string[] = [];
let indexedReferenceIds = new Set<string>();
let indexedPowertrainCodes = new Set<string>();

// Manufacturer English catalog (printed p.150) and the 2015 3022ДЦ.1 manual
// identify the same BF06M1013FC-equipped model. No spelling rule applies to other models.
const MODEL_ALIASES = new Map([['3022дц.1', '3022dc.1']]);
const MODEL_CHAR = '[a-z0-9\\p{Script=Cyrillic}]';
const MODEL_TOKEN_START = `(?<!${MODEL_CHAR})`;
const MODEL_TOKEN_END = `(?!${MODEL_CHAR}|[.-]${MODEL_CHAR})`;
const BELARUS_3022_TOKEN = new RegExp(`${MODEL_TOKEN_START}3022(?:\\.[a-z0-9]+|${MODEL_CHAR}+(?:[.-]${MODEL_CHAR}+)*)${MODEL_TOKEN_END}`, 'giu');
const CYRILLIC_WORD = /^\p{Script=Cyrillic}+$/u;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** References identify documents, not the equipment being diagnosed. Keep scan offsets intact. */
function withoutReferences(text: string): string {
  let clean = text.replace(/\[[^\]\r\n]*\]\((?:https?:\/\/|\/)[^)\r\n]*\)|https?:\/\/[^\s<>，；。！？、：,;!:]+?\.(?:pdf|md)(?=\.[\u4e00-\u9fff])|https?:\/\/[^\s<>，；。！？、：,;!:]+|\b(?:SRC|KB|NH|ZL|LV|DF|HH)-[A-Z0-9-]+\b|\bTK-\d+\b|(?:\/|知识库\/|server\/)[^\s<>，；。！？、：,;:!]+?\.(?:pdf|md)\b|(?<![a-z0-9])[a-z0-9][a-z0-9_.-]*?\.(?:pdf|md)\b/gi,
    (reference) => ' '.repeat(reference.length));
  // New collection ID prefixes are index references, not machine identities.
  // Only registered complete IDs are removed; similar unknown models remain visible.
  clean = clean.replace(/(?<![a-z0-9_-])[a-z0-9]+(?:-[a-z0-9]+)+(?![a-z0-9_-])/gi,
    (reference) => indexedReferenceIds.has(reference.toUpperCase()) ? ' '.repeat(reference.length) : reference);
  for (const number of indexedManualNumbers) {
    clean = clean.replace(new RegExp(`${MODEL_TOKEN_START}${escapeRegex(number)}(?![a-z0-9.\\p{Script=Cyrillic}-])`, 'giu'),
      (reference) => ' '.repeat(reference.length));
  }
  return clean;
}

function cyrillicBrandPattern(alias: string): RegExp {
  return new RegExp(`(?<!\\p{Script=Cyrillic})${alias}(?!\\p{Script=Cyrillic})`, 'giu');
}

function brandsIn(text: string): string[] {
  const lower = withoutReferences(text).toLowerCase();
  return Object.entries(BRAND_ALIASES).filter(([, aliases]) => aliases.some((alias) => {
    if (/^[a-z ]+$/.test(alias)) return new RegExp(`(^|[^a-z])${alias.replace(/ /g, '\\s*')}([^a-z]|$)`).test(lower);
    if (CYRILLIC_WORD.test(alias)) return cyrillicBrandPattern(alias).test(lower);
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

function canonicalModel(model: string): string {
  return MODEL_ALIASES.get(model) ?? model;
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
let modelPatterns: { model: string; pattern: RegExp }[] = [];
let modelFamilies: string[] = ['workmaster', 'lx', 't', 'pl', 'tg'];
let numericModelPattern: RegExp | undefined;
let shortNumericModelPattern: RegExp | undefined;

const numericEdition = 'g\\d+[a-z0-9]*(?:[.-][a-z0-9]+)*';
const parenthesizedEdition = `[ \t]*[(（][ \t]*${numericEdition}[ \t]*[)）][a-z0-9]*`;
const numericModelSuffix = `(?:${parenthesizedEdition}|[ \t]+${numericEdition}|[ \t]*-[ \t]*[a-z][a-z0-9]*(?:${parenthesizedEdition})?|[a-z][a-z0-9]*(?:${parenthesizedEdition})?)`;
const numericMeasurementUnits = [
  'r[ \\t]*[/／][ \\t]*min', 'rpm', 'mpa', 'kpa', 'pa', 'bar', 'kwh', 'kw', 'km/h', 'km',
  'mm', 'cm', 'kg', 'nm', 'n[ \\t]*[·⋅•][ \\t]*m', 'l/min', 'hz', '°[cf]?', '℃', '℉', '[%％‰]',
  '转[ \\t]*(?:[/／每][ \\t]*分(?:钟)?|[·⋅•][ \\t]*分(?:钟)?[⁻−-]?[¹1])',
  '(?:运行)?小时', '分钟', '毫秒', '千瓦(?:时)?', '公里', '千米', '毫米', '厘米', '微米',
  '千克', '公斤(?:力)?', '千帕', '兆帕', '升[ \\t]*[/／每][ \\t]*分(?:钟)?',
  '牛[ \\t]*(?:顿|[·⋅•])?[ \\t]*米', '毫安', '伏特',
].join('|');
const numericMeasurementUnit = `(?:[ \\t]*(?:${numericMeasurementUnits})|[ \\t]+[shval])(?![a-z0-9])`;

/** Rebuilt on reload so source model lists drive recognition as the archive grows. */
export function configureIndexedModels(chunks: KnowledgeChunk[]): void {
  indexedReferenceIds = new Set(chunks.flatMap((chunk) => [chunk.entryId, chunk.sourceId])
    .filter((id): id is string => Boolean(id)));
  // Only registered manual numbers are references; dotted model suffixes remain identities.
  indexedManualNumbers = [...new Set(chunks.flatMap((chunk) =>
    chunk.version?.match(/\bSM-[A-Z0-9]+(?:[.-][A-Z0-9]+)+\b|(?<![a-z0-9\p{Script=Cyrillic}])\d+[\p{Script=Cyrillic}]+\.\d+-\d+(?:-\d+)?\s+РЭ(?!\p{Script=Cyrillic})/giu) ?? [],
  ))];
  const declared = new Set([...chunks.flatMap(declaredModels), ...MODEL_ALIASES.keys(), ...MODEL_ALIASES.values()]);
  indexedModels = [...declared].filter((model) => /^[a-z0-9.]+$/.test(model)).sort((a, b) => b.length - a.length);
  modelPatterns = [...declared].filter((model) => /^[0-9a-z.\p{Script=Cyrillic}]+$/u.test(model)).map((model) => {
    const token = [...model].map(escapeRegex).join('[\\s\\-_/()（）]*');
    return { model, pattern: new RegExp(`${MODEL_TOKEN_START}${token}${MODEL_TOKEN_END}`, 'giu') };
  });
  const numericBases = [...new Set(indexedModels.flatMap((model) => /^(\d{4})(?:g\d+)?$/.exec(model)?.[1] ?? []))];
  // Product names such as 1604(G4) must retain the suffix even when that edition is absent from the archive.
  numericModelPattern = numericBases.length
    ? new RegExp(`${MODEL_TOKEN_START}(?:${numericBases.join('|')})(?!${numericMeasurementUnit})(?:${numericModelSuffix}(?:[.-][a-z0-9]+)*)?${MODEL_TOKEN_END}`, 'giu')
    : undefined;
  // Three-digit names need an explicit suffix, brand, or type label to avoid bare measurement values.
  const shortBases = [...new Set(indexedModels.flatMap((model) => /^(\d{3})(?:g\d+)?$/.exec(model)?.[1] ?? []))];
  const shortBase = `(?:${shortBases.join('|')})(?!${numericMeasurementUnit})`;
  const shortIdentity = '(?:奔野|(?<![a-z])benye|(?:型号|机型)[ \t]*[:：=]?[ \t]*(?:为|是)?)[ \t:：-]*';
  const shortSuffix = `(?:${numericModelSuffix}|[ \t]*-[ \t]*\\d+(?:${parenthesizedEdition})?)`;
  const shortWithSuffix = `${shortBase}${shortSuffix}(?:[.-][a-z0-9]+)*`;
  shortNumericModelPattern = shortBases.length
    ? new RegExp(`(?:${MODEL_TOKEN_START}${shortWithSuffix}|(?<=${shortIdentity})(?:${shortWithSuffix}|${shortBase}))${MODEL_TOKEN_END}`, 'giu')
    : undefined;
  modelPatterns = modelPatterns.filter(({ model }) => !/^(?:\d{3}(?:g\d+)?|\d{4})$/.test(model));
  const modelNames = new Set(indexedModels);
  indexedPowertrainCodes = new Set(chunks.flatMap(chunk => chunk.faultCodes ?? [])
    .map(code => code.toLowerCase()).filter(code => /^p[a-f0-9]{4}$/.test(code) && !modelNames.has(code)));
  modelFamilies = [...new Set([
    'workmaster', 'lx', 't', 'pl', 'tg',
    ...indexedModels.filter(model => !/^\d{3}g\d+$/.test(model)).flatMap((model) => {
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

function withoutHydraulicTestPortLabels(text: string): string {
  const portLabel = /((?:测压[口点]|压力?测试?[口点]|(?:液压|压力)检测[口点]|\bpressure\s+(?:test\s+)?(?:port|point|tap)\b)\s*[:：#]?\s*)([A-Z]{1,2}\d{1,2})(?![a-z0-9_.-])/gi;
  return text.replace(portLabel, (_match, prefix: string, label: string) => prefix + ' '.repeat(label.length))
    .replace(/(测(?:量|试)?\s*)([A-Z]\d{1,2})(?=\s*(?:口\s*)?压力)/gi,
      (_match, prefix: string, label: string) => prefix + ' '.repeat(label.length));
}

function withoutNumericMeasurementsOrSerials(text: string): string {
  // Only unambiguous labels qualify single-letter units and numbers used as parts or serial references.
  const serialNumber = /((?:零件号|零件编号|部件号|部件编号|整机号|整机编号|出厂号|出厂编号|车架号|发动机号|序列号|线束编号)[ \t]*[:：=#]?[ \t]*(?:为|是)?[ \t]*)(\d{3,4}(?:[a-z0-9]+|[.-][a-z0-9]+)*)(?![a-z0-9]|[.-][a-z0-9])/gi;
  const ordinal = /(第[ \t]*)(\d{3,4})(?=[ \t]*号(?:线|针脚|插针|端子))/g;
  const engineSpeed = /((?:每分钟|发动机转速|主轴转速|PTO转速)[ \t]*[:：=]?[ \t]*(?:为|是)?[ \t]*)(\d{3,4})(?=[ \t]*转(?!向|动|速|矩|子|轴|换|角))/gi;
  const hours = /((?:工时|运行时间|使用时间|运行|运转|工作|开机|累计)[ \t]*[:：=]?[ \t]*(?:为|是)?[ \t]*)(\d{3,4}[ \t]*h)(?![a-z0-9])/gi;
  const liters = /((?:油箱容量|容积|容量|加注|补充|消耗|油量)[ \t]*[:：=]?[ \t]*(?:为|是)?[ \t]*)(\d{3,4}[ \t]*[l升])(?![a-z0-9]|降|程|举|高|压|档|挡)/gi;
  const blankValue = (_match: string, label: string, value: string) => label + ' '.repeat(value.length);
  return text.replace(serialNumber, blankValue).replace(ordinal, blankValue)
    .replace(engineSpeed, blankValue).replace(hours, blankValue).replace(liters, blankValue);
}

function modelMentions(text: string): ModelMention[] {
  // Preserve the existing LX2620-LX2620SU grouped alias without merging two identities.
  const scanText = withoutHydraulicTestPortLabels(withoutReferences(text)).replace(/-(?=lx\s*\d)/gi, '/')
    .replace(displayFaultCodePattern, code => ' '.repeat(code.length))
    .replace(threeFieldFaultCodePattern, code => ' '.repeat(code.length))
    .replace(/((?:故障码|错误码|报警码|报码|\b(?:dtc|(?:fault|error)\s+code)\b)\s*[:：=]?\s*)([a-z]+\d[a-z0-9]*(?:[.-][a-z0-9]+)*|\d{1,7}(?:\.\d{1,2})?)(?![a-z0-9_.-])/gi,
      (_match, label: string, code: string) => label + ' '.repeat(code.length))
    .replace(/\bp[a-f0-9]{4}\b/gi, code => indexedPowertrainCodes.has(code.toLowerCase()) ? ' '.repeat(code.length) : code);
  const mentions: ModelMention[] = [];
  for (const {model, pattern} of modelPatterns) {
    for (const match of scanText.matchAll(pattern)) {
      mentions.push({ start: match.index!, end: match.index! + match[0].length, model });
    }
  }
  const numericText = withoutNumericMeasurementsOrSerials(scanText);
  for (const pattern of [numericModelPattern, shortNumericModelPattern]) {
    if (!pattern) continue;
    for (const match of numericText.matchAll(pattern)) {
      mentions.push({ start: match.index!, end: match.index! + match[0].length, model: normalizeModel(match[0]) });
    }
  }
  // Nearby unknown 3022 variants remain complete identities, including mixed scripts.
  for (const match of scanText.matchAll(BELARUS_3022_TOKEN)) {
    mentions.push({ start: match.index!, end: match.index! + match[0].length, model: normalizeModel(match[0]) });
  }
  // Unknown models in indexed families remain identities, preventing a generic fallback.
  const families = modelFamilies.map(escapeRegex).join('|');
  const regex = new RegExp(`${MODEL_TOKEN_START}(?:${families})[\\s-]*\\d[a-z0-9]*(?:[.-]\\s*[a-z0-9]+)*(?:\\s+(?:pro|su))?(?:\\s*[(（]\\s*g\\d+\\s*[)）])?(?!${MODEL_CHAR})`, 'giu');
  for (const match of scanText.matchAll(regex)) {
    mentions.push({ start: match.index!, end: match.index! + match[0].length, model: normalizeModel(match[0]) });
  }
  // Unknown families require a recognized brand or an explicit model label, never a bare number.
  const letters = '[a-z\\p{Script=Cyrillic}]';
  const candidate = `(?:${letters}+|\\d+${letters}+)[\\s-]*\\d${MODEL_CHAR}*(?:[.-]\\s*${MODEL_CHAR}+)*(?:\\s+(?:pro|su))?(?:\\s*[(（]\\s*g\\d+\\s*[)）])?`;
  const aliases = Object.values(BRAND_ALIASES).flat().sort((a, b) => b.length - a.length)
    .map((alias) => /^[a-z ]+$/.test(alias)
      ? `(?<![a-z])${alias.replace(/ /g, '\\s*')}(?![a-z])` : escapeRegex(alias)).join('|');
  for (const pattern of [
    new RegExp(`(?:${aliases})[\\s:：-]*(${candidate})(?!${MODEL_CHAR})`, 'giu'),
    new RegExp(`(?:型号|机型)\\s*[:：=]?\\s*(?:为|是)?\\s*(${candidate})(?!${MODEL_CHAR})`, 'giu'),
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
  const models = modelMentions(text).map((mention) => canonicalModel(mention.model));
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
        : CYRILLIC_WORD.test(alias)
          ? text.replace(cyrillicBrandPattern(alias), ' ')
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
  /** No brand and no concrete model named: archive and 通识 entries are searched together (2026-10-22). */
  openArchive: boolean;
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
  const contextModels = explicitModel ? [...new Set(declaredModels({ source: '', heading: '', text: '',
    model: normalizeNationalEmissions(explicitModel).replace(/国三|国四/g, ''),
  }).filter(Boolean).map(canonicalModel))] : [];
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
  // “联合收获机 / 收获机”是用户对联合收割机的常用说法，与“收割机”同指一类机型；
  // 只写“收割机”会漏掉它，导致联合收获机问题被当成拖拉机问题检索（2026-11-07 实测）。
  const nonTractor = /收割机|收获机|插秧机|植保机|播种机|无人机|\b(combine|transplanter|sprayer)\b/i;
  const nonTractorQuery = nonTractor.test(queryIdentity);
  const tractorArchive = type ? tractorContext : !nonTractorQuery;
  // Clearly attached implements are not a change of the machine being discussed.
  // 配套 / 配装也是挂接动词（归档条目 KB-WZ-TSME-0374《配套收获机械时加高一级
  // 滤清器效果更好》说的就是拖拉机配套收获机具时的滤清器做法，不是换机型）。
  const queryTypeIdentity = queryIdentity.replace(/(?:挂接|连接|牵引|配套|配装|\bPTO\s*接)\s*(?:的\s*)?(?:收割机|收获机|插秧机|植保机|播种机|无人机|combine|transplanter|sprayer)/gi, ' ');
  const typeConflict = Boolean(type && (tractorContext ? nonTractor.test(queryTypeIdentity)
    : nonTractor.test(type) && /拖拉机|\btractor\b/i.test(queryTypeIdentity)));
  const identityConflict = brandConflict || modelConflict || typeConflict;
  // Powered accessories and service tools do not identify the tractor's propulsion system.
  const queryPowerIdentity = queryIdentity.replace(/电动(?:工具|扳手|螺丝刀)|\belectric\s+(?:tools?|wrenches?|screwdrivers?)\b/gi, ' ')
    .replace(/电动(?=(?:供油|输油|燃油|提升|液压|冷却|水|机油|润滑)?泵|风扇|预热装置|雨刷|座椅|车窗)|\belectric\s+(?=(?:(?:fuel|lift|feed|hydraulic|coolant|oil|water)\s+){0,2}pumps?\b|fans?\b|wipers?\b)/gi, '')
    // Manual steering becoming unavailable does not identify an autonomous tractor.
    .replace(/无人力转向/g, '人力转向')
    // A named transmission control is not an electric tractor identity.
    .replace(/电动指令变速器/g, '变速器')
    .replace(/(?:起动|启动)电动机/g, '起动机');
  const electric = /电动|新能源|无人|electric|autonomous|new-energy/i.test([type, explicitBrand, context.model, queryPowerIdentity].filter(Boolean).join(' ')) ||
    brand === '鸿鹄' || models.includes('t70');
  const ambiguous = queryBrands.length > 1 || contextBrands.length > 1;
  return { brand, models, emissions, configurations, driveConfigurations, ambiguous, identityConflict, tractorArchive, electric, genericKnowledge: tractorArchive && !identityConflict && !electric && !brand && models.length === 0 && emissions.length === 0 && !ambiguous,
    openArchive: tractorArchive && !identityConflict && !electric && !ambiguous && !brand && models.every((model) => model === '国三' || model === '国四') };
}

/** Matching is identity selection, not proof of market, configuration or version applicability. */
export function archiveApplicability(chunk: KnowledgeChunk, scope: ResolvedScope): 'matched' | 'pending' | undefined {
  const brand = canonicalBrand(chunk.brand);
  if (!scope.tractorArchive || scope.ambiguous || scope.identityConflict || (scope.brand && scope.brand !== brand)) return undefined;
  if (scope.electric && brand !== '鸿鹄' && brand !== '千寻位置') return undefined;
  if (chunk.configuration && scope.configurations.some((configuration) => configuration !== chunk.configuration)) return undefined;
  if (chunk.driveConfiguration && scope.driveConfigurations.some((configuration) => configuration !== chunk.driveConfiguration)) return undefined;
  const allowed = declaredModels(chunk).map(canonicalModel);
  const emissionStage = chunk.emissionStage ?? (chunk.emissionStageUnknown ? undefined
    : chunk.model === '国三拖拉机' ? '国三'
      : allowed.length > 0 && allowed.every((model) => model.endsWith('g4')) ? '国四' : undefined);
  if (scope.emissions.some((stage) => stage !== emissionStage)) return undefined;
  const models = scope.models.filter((model) => model !== '国三' && model !== '国四');
  // Open question (no brand/model): every archive entry is a pending candidate, never 'matched'.
  if (models.length === 0 && !scope.brand) return scope.openArchive ? 'pending' : undefined;
  if (models.length === 0) return !chunk.requiresExactModel && scope.brand === brand ? 'pending' : undefined;

  if (chunk.model === '具体系列待核实') return scope.brand === brand ? 'pending' : undefined;
  if (chunk.model === '国三拖拉机' && scope.brand !== brand) return undefined;
  if (!models.every((model) => allowed.includes(model))) return undefined;
  return models.some((model) => /\d/.test(model)) ? 'matched' : 'pending';
}
