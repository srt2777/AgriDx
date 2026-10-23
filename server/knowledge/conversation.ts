import { queryWithoutIdentity, resolveScope, type RetrievalContext } from './scope';

export interface DiagnosticHistoryMessage {
  role: string;
  content: string;
}

export interface DiagnosticContext {
  /** Latest user text, for the answer to address the current turn. */
  currentQuery: string;
  symptomQuery: string;
  /** Symptom plus user-declared identity and current applicability constraints. */
  query: string;
  scope: RetrievalContext;
  /** A user has denied an identity and has not supplied its replacement yet. */
  clarificationNeeded: boolean;
}

const MACHINE_TYPES: [RegExp, string][] = [
  [/联合收割机|收割机|\bcombine\b/i, '联合收割机'],
  [/插秧机|\btransplanter\b/i, '插秧机'],
  [/植保机|\bsprayer\b/i, '植保机'],
  [/播种机|\bseeder\b/i, '播种机'],
  [/无人农机|无人拖拉机|\bautonomous\b/i, '无人农机'],
  [/新能源农机|电动拖拉机|电动农机|\belectric\b|new-energy/i, '新能源农机'],
  [/拖拉机|\btractor\b/i, '拖拉机'],
];

function declaredMachineType(text: string): string | undefined {
  // Document references and an explicitly attached implement do not identify
  // the primary machine. Use the same implement exception as the scope gate.
  const primary = queryWithoutIdentity(text).replace(
    /(?:挂接|连接|牵引|\bPTO\s*接)\s*(?:的\s*)?(?:收割机|插秧机|植保机|播种机|无人机|combine|transplanter|sprayer)/gi,
    ' ',
  );
  return MACHINE_TYPES.find(([pattern]) => pattern.test(primary))?.[1];
}

/** Remove only selection constraints. They are reattached from the latest user declaration. */
function withoutSelection(text: string): string {
  return queryWithoutIdentity(text).replace(
    /\bcab\b|\brops\b|驾驶室|防翻滚架|防翻架|\b2wd\b|\b4wd\b|两轮驱动|二轮驱动|四轮驱动|两驱|二驱|四驱|联合收割机|收割机|插秧机|植保机|播种机|无人农机|无人拖拉机|新能源农机|电动拖拉机|电动农机|拖拉机|\b(?:tractor|combine|transplanter|sprayer|electric|autonomous)\b/gi,
    ' ',
  ).trim();
}

function identityOnly(text: string, model?: string): boolean {
  const remainder = withoutSelection(text).replace(
    /尚未核对|尚未确认|待核对|待确认|未核对|未确认|暂时不知道|不清楚|未知|铭牌|发动机(?:型号)?|排放(?:标准|阶段)?|完整|信息|我的|我这台|这台|那台|这辆|那辆|品牌|牌子|型号|机型|系列|平台|欧豹|具体|就是|是|为|用的|换成|换一台|另外一台|另一台|不是|而是|不对|的|[\s，,。.!！?？:：;；/]/g,
    '',
  );
  // Unknown model families are not removed by the indexed identity tokenizer.
  // A recognized short model answer still completes the previous diagnosis.
  return !remainder || Boolean(model && remainder.toLowerCase().replace(/[\s\-_/()（）]/g, '') ===
    model.toLowerCase().replace(/[\s\-_/()（）]/g, ''));
}

function correctionText(text: string): string {
  // "不是久保田，是东方红" selects only the corrected declaration.
  const corrected = text.replace(/^.*?不是[^，,；;。\n]*?(?:[，,；;]\s*(?:而是|是|换成)|而是)\s*/, '');
  return corrected.trim() ? corrected : text;
}

function modelFromText(text: string, hasBrand: boolean, hasModel: boolean): string | undefined {
  const known = resolveScope(text, {}).models.filter((model) => model !== '国三' && model !== '国四');
  if (known.length) return known.join('/');
  const explicit = text.match(/(?:型号|机型)\s*(?:是|为|[:：])?\s*([a-z0-9][a-z0-9.\-_ /()（）]*\d[a-z0-9.\-_ /()（）]*|\d+[a-z0-9.\-_ /()（）]*)/i)?.[1]?.trim();
  if (explicit) return explicit;
  // Short model answers are common after the user has supplied the brand.
  const bare = text.trim().replace(/[，,。！!？?；;]+$/g, '').trim();
  if (hasBrand && (!hasModel || /[a-z]/i.test(bare)) && /^(?=.*\d)[a-z0-9][a-z0-9.\-_ /()（）]*$/i.test(bare)) return bare;
  return undefined;
}

type IdentityField = 'machineType' | 'brand' | 'model';

/** Denials invalidate a declaration; they are never positive equipment names. */
function removeDeniedIdentities(text: string, scope: RetrievalContext): { text: string; denied: Set<IdentityField> } {
  const denied = new Set<IdentityField>();
  const clean = text.replace(/(?:不是|并非|不属于)\s*([^，,。；;!?！？\n]*)/g, (whole, fragment: string) => {
    const identity = resolveScope(fragment, {});
    const model = modelFromText(fragment, Boolean(scope.brand || scope.model), false);
    const machineType = declaredMachineType(fragment);
    const brandDenied = Boolean(identity.brand || /(?:品牌|牌子)/.test(fragment) ||
      (scope.brand && fragment.trim().toLowerCase() === scope.brand.toLowerCase()));
    const typeDenied = Boolean(machineType ||
      (scope.machineType && fragment.trim().toLowerCase() === scope.machineType.toLowerCase()));
    if (brandDenied) denied.add('brand');
    if (model) denied.add('model');
    if (typeDenied) denied.add('machineType');
    return brandDenied || model || typeDenied ? '' : whole;
  });
  // Without an object, do not guess which proposed identity the user denied.
  if (/^(?:不是|不是的|不对|不对的)[。！!？?]*$/.test(text.trim())) {
    denied.add('brand');
    denied.add('model');
    denied.add('machineType');
    return { text: '', denied };
  }
  return { text: clean, denied };
}

function isContinuation(text: string): boolean {
  const clean = text.trim();
  return clean.length <= 100 && (
    /^(?:那|还|也|只|只有|仅|但是|不过|现在|刚才|补充|继续|下一步|已经|已检查|检查结果|测量结果|怎么|为什么|需要|应该|能不能|可以|是否|多久|多长|多少|什么油|有什么|怎么办|会不会|是的|对|不是|请问|具体)/.test(clean) ||
    /已(?:经)?(?:检查|测量|更换|排除)|检查.*(?:正常|异常|完成)|换过|测过/.test(clean) ||
    /空载|负载|带负荷|怠速|加油门|热车|冷车|挂挡|行驶时|作业时|启动时|起动时|报警|故障码/.test(clean)
  );
}

/**
 * Build retrieval context from user declarations, never from assistant suggestions.
 * Complete new questions replace old symptoms; short identity/operating-condition
 * answers retain the diagnostic question. A machine change clears old constraints.
 */
export function resolveDiagnosticContext(
  history: readonly DiagnosticHistoryMessage[],
  explicitScope: RetrievalContext = {},
): DiagnosticContext {
  // Legacy API already limits its input. Persistent sessions supply the full,
  // bounded user transcript so early symptoms and corrections remain available.
  const users = history.filter((message) => message.role === 'user');
  const scope: RetrievalContext = {};
  let symptoms: string[] = [];
  let emissions: string[] = [];
  let configurations: string[] = [];
  let drives: string[] = [];
  let ambiguousIdentity = '';
  const pendingIdentity = new Set<IdentityField>();
  let currentDeclaration = '';

  for (const message of users) {
    const corrected = correctionText(message.content.trim());
    const declaration = removeDeniedIdentities(corrected, { ...explicitScope, ...scope });
    const text = declaration.text;
    currentDeclaration = text;
    for (const field of declaration.denied) pendingIdentity.add(field);
    if (declaration.denied.has('brand') && scope.model) pendingIdentity.add('model');
    if (declaration.denied.has('brand') || declaration.denied.has('machineType')) {
      delete scope.brand;
      delete scope.model;
      ambiguousIdentity = '';
    } else if (declaration.denied.has('model')) delete scope.model;
    if (declaration.denied.has('machineType')) delete scope.machineType;
    const detected = resolveScope(text, {});
    const brand = detected.brand ?? text.match(/(?:品牌|牌子)\s*(?:是|为|[:：])\s*([^\s，,。；;]{1,30})/)?.[1];
    const model = modelFromText(text, Boolean(brand || scope.brand), Boolean(scope.model));
    const machineType = declaredMachineType(text);
    const replacedMachine = /换一台|另一台|另外一台|换成/.test(message.content) ||
      Boolean(machineType && scope.machineType && machineType !== scope.machineType);
    const changed = Boolean(
      (brand && scope.brand && brand !== scope.brand) ||
      (model && scope.model && model !== scope.model) ||
      (machineType && scope.machineType && machineType !== scope.machineType) ||
      replacedMachine,
    );
    if (changed) {
      if (replacedMachine || (brand && brand !== scope.brand)) {
        delete scope.brand;
        delete scope.model;
      } else if (model) delete scope.model;
      // A corrected brand/model may describe the same machine. Previously
      // declared emissions/configuration remain constraints until corrected
      // themselves or the user explicitly switches to a different machine.
      if (replacedMachine) {
        if (!machineType) delete scope.machineType;
        emissions = [];
        configurations = [];
        drives = [];
      }
    }
    if (detected.ambiguous) {
      delete scope.brand;
      delete scope.model;
      ambiguousIdentity = text;
    } else if (brand || model) ambiguousIdentity = '';
    if (brand) {
      if (scope.brand && scope.brand !== brand) delete scope.model;
      scope.brand = brand;
      pendingIdentity.delete('brand');
    }
    if (model) {
      scope.model = model;
      pendingIdentity.delete('model');
    }
    if (machineType) {
      scope.machineType = machineType;
      pendingIdentity.delete('machineType');
    }
    if (detected.emissions.length) emissions = detected.emissions;
    if (detected.configurations.length) configurations = detected.configurations;
    if (detected.driveConfigurations.length) drives = detected.driveConfigurations;

    const body = withoutSelection(text);
    if (!body || identityOnly(text, model)) continue;
    if (symptoms.length && isContinuation(body)) symptoms = [symptoms[0], ...(symptoms.length > 1 ? symptoms.slice(-1) : []), body];
    else symptoms = [body];
  }

  // Keep the active user declaration before applying request fields. The scope
  // gate must see both identities to reject conflicting fields; removing user
  // identities from the symptom text must never bypass that check.
  const declaredScope = { ...scope };
  const explicitBrand = resolveScope('', explicitScope).brand;
  if (explicitBrand && explicitBrand !== scope.brand && !explicitScope.model?.trim() &&
    !pendingIdentity.has('brand') && !pendingIdentity.has('machineType')) {
    delete scope.model;
  }
  for (const field of ['machineType', 'brand', 'model'] as const) {
    // Stale form values cannot restore an identity the user just denied.
    if (pendingIdentity.has(field) || (field !== 'machineType' && pendingIdentity.has('machineType')) ||
      (field === 'model' && pendingIdentity.has('brand'))) continue;
    if (explicitScope[field]?.trim()) scope[field] = explicitScope[field]!.trim();
  }
  const currentQuery = users.at(-1)?.content.trim() ?? '';
  return {
    currentQuery,
    symptomQuery: symptoms.join(' ').replace(/请区分本地资料依据和模型补充分析[。.]?/g, '').trim(),
    query: [
      scope.brand, scope.model, scope.machineType,
      declaredScope.brand, declaredScope.model, declaredScope.machineType,
      ambiguousIdentity, ...emissions, ...configurations, ...drives, ...symptoms,
      // Preserve same-turn conflicts and unknown identities in their original
      // spelling. Retired machines remain excluded; explicit corrections use
      // only the corrected declaration.
      currentDeclaration,
    ].filter(Boolean).join(' '),
    scope,
    clarificationNeeded: pendingIdentity.size > 0,
  };
}
