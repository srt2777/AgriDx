import { createPlan, type PlannerScope, type PlannerState, type StepDefinition } from '../../agent/planner';

/** Narrow, manually reviewed symptom families. These are not fault diagnoses. */
export type PlannerTopic = 'overheat' | 'starting' | 'fuel' | 'electrical' | 'hydraulic' | 'transmission';

/** Every known topic, in a fixed order for the single-match rule below. */
export const PLANNER_TOPICS: readonly PlannerTopic[] = ['overheat', 'starting', 'fuel', 'electrical', 'hydraulic', 'transmission'];

export function isPlannerTopic(value: unknown): value is PlannerTopic {
  return typeof value === 'string' && (PLANNER_TOPICS as readonly string[]).includes(value);
}

const PLANNER_TOPIC_PATTERNS: Record<PlannerTopic, RegExp> = {
  overheat: /(?:水温|冷却|散热|冷却液|发动机温度).{0,24}(?:过高|太高|升高|偏高|很高|高温|过热|开锅|报警)|(?:过高|太高|偏高|高温|过热|开锅).{0,16}(?:水温|冷却|散热|发动机)/i,
  starting: /(?:无法|不能|不易|难以|不能够|没法).{0,8}(?:启动|起动|着车)|(?:启动|起动).{0,10}(?:不了|不着|困难|失败|异常|不成功)|打不着|不着车|(?:电瓶|蓄电池|电池).{0,12}(?:亏电|没电|不充电|无法充电|故障|异常|损坏)/i,
  // Deliberately narrow: "电瓶不充电" stays with starting (battery word +
  // 不充电); only the charging-system lamp wording reaches electrical.
  fuel: /(?:燃油|供油|喷油|滤清器|油泵).{0,12}(?:不足|堵塞|脏污|故障|异常|漏油|不畅|脏了|堵了|有问题)|憋熄|熄火|(?:排气|尾气).{0,4}烟|冒黑烟|冒白烟/i,
  electrical: /(?:保险丝|线束|电气|灯光|照明|断电|供电|充电系统|发电机).{0,12}(?:熔断|松动|破损|失效|异常|故障|不亮|灯亮)?/i,
  hydraulic: /(?:液压|农具提升|提升缓慢|提升.{0,4}抖动|悬挂|油缸)/i,
  transmission: /(?:离合器|挂挡|换挡|变速箱|变速|起步抖动)/i,
};

/** All topics a text matches, in the fixed PLANNER_TOPICS order. Empty when the text matches none. */
export function identifyPlannerTopics(text: string): PlannerTopic[] {
  if (typeof text !== 'string' || text.length > 8000) return [];
  return PLANNER_TOPICS.filter(topic => PLANNER_TOPIC_PATTERNS[topic].test(text));
}

/** Apply to the user's original fault question, not an arbitrary later reply. */
export function identifyPlannerTopic(text: string): PlannerTopic | undefined {
  const matched = identifyPlannerTopics(text);
  // Ambiguous multi-system questions cannot safely select a single template.
  return matched.length === 1 ? matched[0] : undefined;
}

/** Short system labels for clarification only: never a diagnosis, never evidence. */
export const PLANNER_TOPIC_LABELS: Readonly<Record<PlannerTopic, string>> = {
  overheat: '水温过高（冷却系统）',
  starting: '无法启动（启动系统）',
  fuel: '燃油供给异常',
  electrical: '电气与供电照明异常',
  hydraulic: '液压与农具提升异常',
  transmission: '传动与离合挂挡异常',
};

export function plannerTopicLabel(topic: PlannerTopic): string {
  return PLANNER_TOPIC_LABELS[topic];
}

/**
 * Evidence-constrained clarification for a multi-system ambiguous fault
 * text. The question names only the candidate systems and asks the user to
 * pick one; it carries no evidence IDs and states no fault conclusion, so
 * it can be shown without selecting a template or a cause. Returns
 * undefined for single-topic or unidentified text (those paths keep their
 * existing handling).
 */
export function plannerAmbiguityQuestion(text: string): string | undefined {
  const matched = identifyPlannerTopics(text);
  if (matched.length < 2) return undefined;
  const candidates = matched.map(topic => PLANNER_TOPIC_LABELS[topic]).join('、');
  return `你描述的现象可能同时涉及以下多个系统，目前还不能确定是哪一个，也没有据此作出故障结论：${candidates}。请先确认主要想排查哪一个（只选一个），或补充最先出现、最明显的现象；确认后我再按该系统的检查步骤继续。`;
}

// These questions request only observations already available. They are not
// derived from, or claimed to be supported by, a particular repair manual.
const templates: Readonly<Record<PlannerTopic, readonly StepDefinition[]>> = {
  overheat: [
    { key: 'cooling-leak', title: '已有冷却液泄漏检查记录', kind: 'ask_user', dependsOn: [], preconditions: [],
      expectedObservation: { slot: 'cooling-leak', label: '冷却液泄漏已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: [], discriminationValue: 20, cost: 1 },
    { key: 'cooling-radiator', title: '已有散热器表面遮挡检查记录', kind: 'ask_user', dependsOn: ['cooling-leak'], preconditions: [],
      expectedObservation: { slot: 'cooling-radiator', label: '散热器表面遮挡已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: [], discriminationValue: 10, cost: 1 },
  ],
  starting: [
    { key: 'battery', title: '已有电瓶检查结果', kind: 'ask_user', dependsOn: [], preconditions: [],
      expectedObservation: { slot: 'battery', label: '电瓶已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: [], discriminationValue: 20, cost: 1 },
    { key: 'starter', title: '已有起动机检查记录', kind: 'ask_user', dependsOn: ['battery'], preconditions: [],
      expectedObservation: { slot: 'starter', label: '起动机已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: [], discriminationValue: 10, cost: 1 },
  ],
  // New topics carry real, verified, indexed knowledge entries (see
  // topicEvidence below). A step is only proposed when its entry is
  // retrieved this turn as an exact, verified model match, so a new topic
  // never fires for a model the entry does not cover. toolName records
  // which read-only tool can supply the step's evidence; it is not
  // executed by the planner.
  fuel: [
    { key: 'fuel-filter', title: '已有燃油滤清器检查记录', kind: 'ask_user', dependsOn: [], preconditions: [],
      expectedObservation: { slot: 'fuel-filter', label: '燃油滤清器已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['KB-JD-5E-D0-025'], discriminationValue: 20, cost: 1, toolName: 'search_knowledge' },
    { key: 'fuel-injector', title: '已有喷油器检查记录', kind: 'ask_user', dependsOn: ['fuel-filter'], preconditions: [],
      expectedObservation: { slot: 'fuel-injector', label: '喷油器已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['TF1000-JD6B-119'], discriminationValue: 10, cost: 1, toolName: 'search_knowledge' },
  ],
  electrical: [
    { key: 'electrical-fuse', title: '已有保险丝检查记录', kind: 'ask_user', dependsOn: [], preconditions: [],
      expectedObservation: { slot: 'electrical-fuse', label: '保险丝已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['KB-KB-M6060-006'], discriminationValue: 20, cost: 1, toolName: 'search_knowledge' },
    { key: 'electrical-lighting', title: '已有灯光与全车供电检查记录', kind: 'ask_user', dependsOn: ['electrical-fuse'], preconditions: [],
      expectedObservation: { slot: 'electrical-lighting', label: '灯光与全车供电已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['ZL-PL-015'], discriminationValue: 10, cost: 1, toolName: 'search_knowledge' },
  ],
  hydraulic: [
    { key: 'hydraulic-lift', title: '已有农具提升检查记录', kind: 'ask_user', dependsOn: [], preconditions: [],
      expectedObservation: { slot: 'hydraulic-lift', label: '农具提升已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['KB-YTO-LF-MANUAL-012'], discriminationValue: 20, cost: 1, toolName: 'search_knowledge' },
    { key: 'hydraulic-system', title: '已有整个液压系统检查记录', kind: 'ask_user', dependsOn: ['hydraulic-lift'], preconditions: [],
      expectedObservation: { slot: 'hydraulic-system', label: '整个液压系统已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['KB-JD-6B-L1-019'], discriminationValue: 10, cost: 1, toolName: 'search_knowledge' },
  ],
  transmission: [
    { key: 'clutch', title: '已有离合器检查记录', kind: 'ask_user', dependsOn: [], preconditions: [],
      expectedObservation: { slot: 'clutch', label: '离合器已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['KB-WD-WF-007'], discriminationValue: 20, cost: 1, toolName: 'search_knowledge' },
    { key: 'gear-shift', title: '已有变速箱挂挡检查记录', kind: 'ask_user', dependsOn: ['clutch'], preconditions: [],
      expectedObservation: { slot: 'gear-shift', label: '变速箱挂挡已有检查结果', options: ['检查正常', '检查异常', '未检查', '不确定'] },
      evidenceIds: ['KB-JD-5E-D0-070'], discriminationValue: 10, cost: 1, toolName: 'search_knowledge' },
  ],
};

/** Only these reviewed aliases bind a user's report to a plan step. */
export function plannerStepAliases(stepKey: string): readonly string[] {
  switch (stepKey) {
    case 'cooling-leak': return ['冷却液泄漏', '冷却液渗漏', '冷却系统泄漏', '冷却液漏液'];
    case 'cooling-radiator': return ['散热器表面遮挡', '散热器表面', '散热器遮挡', '散热器'];
    case 'battery': return ['蓄电池', '电瓶', '电池'];
    case 'starter': return ['起动机', '启动机', '起动马达', '启动马达'];
    case 'fuel-filter': return ['燃油滤清器', '燃油滤芯', '供油滤清器'];
    case 'fuel-injector': return ['喷油器', '喷油嘴', '喷油泵'];
    case 'electrical-fuse': return ['保险丝', '保险片', '熔断器'];
    case 'electrical-lighting': return ['灯光', '照明', '全车断电', '全车供电'];
    case 'hydraulic-lift': return ['农具提升', '提升缓慢', '提升抖动', '悬挂提升'];
    case 'hydraulic-system': return ['整个液压系统', '液压系统不工作', '液压无力'];
    case 'clutch': return ['离合器', '离合'];
    case 'gear-shift': return ['挂挡', '换挡', '变速箱挂挡', '变速箱卡挡'];
    default: return [];
  }
}

/**
 * Plan-level evidence references for every topic. createPlan rejects a
 * step whose evidenceIds are not listed here, so the two must stay in
 * sync. overheat/starting keep empty references (their historical
 * evidence gate is vacuous); the four new topics each carry exactly one
 * verified, indexed entry per step, taken from the knowledge snapshot:
 * fuel-filter KB-JD-5E-D0-025 (约翰迪尔 5E, 燃油滤清器每日排水和沉淀物),
 * fuel-injector TF1000-JD6B-119 (约翰迪尔 6B, 喷油器脏污或故障),
 * electrical-fuse KB-KB-M6060-006 (久保田 M6060/M7060, 保险丝熔断先查原因),
 * electrical-lighting ZL-PL-015 (中联 PL系列, 照明失效与全车断电的排查区别),
 * hydraulic-lift KB-YTO-LF-MANUAL-012 (东方红 LF系列, 农具不能提升或提升缓慢抖动),
 * hydraulic-system KB-JD-6B-L1-019 (约翰迪尔 6B, 整个液压系统不工作),
 * clutch KB-WD-WF-007 (沃得 WF1404/1504/1604, 离合器打滑与分离不彻底故障表),
 * gear-shift KB-JD-5E-D0-070 (约翰迪尔 5E, 变速箱卡在空挡或换挡困难).
 */
export const topicEvidence: Readonly<Record<PlannerTopic, readonly { entryId: string; sourceId: string }[]>> = {
  overheat: [],
  starting: [],
  fuel: [
    { entryId: 'KB-JD-5E-D0-025', sourceId: 'SRC-JD-5E-D0-OMSJ34997' },
    { entryId: 'TF1000-JD6B-119', sourceId: 'SRC-JD-6B-L1-OMSU54855' },
  ],
  electrical: [
    { entryId: 'KB-KB-M6060-006', sourceId: 'SRC-KB-M6060-3C13199724' },
    { entryId: 'ZL-PL-015', sourceId: 'SRC-ZL-PL-202011' },
  ],
  hydraulic: [
    { entryId: 'KB-YTO-LF-MANUAL-012', sourceId: 'SRC-YTO-LF-MANUAL' },
    { entryId: 'KB-JD-6B-L1-019', sourceId: 'SRC-JD-6B-L1-OMSU54855' },
  ],
  transmission: [
    { entryId: 'KB-WD-WF-007', sourceId: 'SRC-WD-WF1404-1604-2021' },
    { entryId: 'KB-JD-5E-D0-070', sourceId: 'SRC-JD-5E-D0-OMSJ34997' },
  ],
};

/**
 * Fault-chain view of each topic: top event (the symptom) decomposed into
 * causes, each cause bound to one planner step and its evidence. This is
 * structure only — discriminationValue order is the question-value proxy
 * (a step that can split several causes is asked first); it is never a
 * fault probability, and every basic event stays a user report or a
 * manual entry marked unverified until the user confirms it.
 */
export interface FaultChainCause { cause: string; stepKey: string; evidenceIds: readonly string[] }
export interface FaultChain { topEvent: string; causes: readonly FaultChainCause[] }
export const plannerFaultChains: Readonly<Record<PlannerTopic, FaultChain>> = {
  overheat: { topEvent: '发动机水温过高', causes: [
    { cause: '冷却液泄漏导致冷却不足', stepKey: 'cooling-leak', evidenceIds: [] },
    { cause: '散热器表面遮挡导致散热不足', stepKey: 'cooling-radiator', evidenceIds: [] },
  ] },
  starting: { topEvent: '发动机无法启动', causes: [
    { cause: '电瓶亏电或损坏导致启动无力', stepKey: 'battery', evidenceIds: [] },
    { cause: '起动机故障导致无法转动', stepKey: 'starter', evidenceIds: [] },
  ] },
  fuel: { topEvent: '燃油供给异常（熄火、憋熄、冒烟）', causes: [
    { cause: '燃油滤清器堵塞或沉淀导致供油不足', stepKey: 'fuel-filter', evidenceIds: ['KB-JD-5E-D0-025'] },
    { cause: '喷油器脏污或故障导致雾化与供油异常', stepKey: 'fuel-injector', evidenceIds: ['TF1000-JD6B-119'] },
  ] },
  electrical: { topEvent: '电气异常（熔断、灯光或供电失效）', causes: [
    { cause: '保险丝熔断或线束异常导致回路断开', stepKey: 'electrical-fuse', evidenceIds: ['KB-KB-M6060-006'] },
    { cause: '照明回路与全车供电的排查范围不同', stepKey: 'electrical-lighting', evidenceIds: ['ZL-PL-015'] },
  ] },
  hydraulic: { topEvent: '液压动作异常（提升无力或系统不工作）', causes: [
    { cause: '吸油或提升回路异常导致农具提升缓慢或抖动', stepKey: 'hydraulic-lift', evidenceIds: ['KB-YTO-LF-MANUAL-012'] },
    { cause: '整个液压系统不工作', stepKey: 'hydraulic-system', evidenceIds: ['KB-JD-6B-L1-019'] },
  ] },
  transmission: { topEvent: '传动异常（离合器或挂挡故障）', causes: [
    { cause: '离合器打滑或分离不彻底', stepKey: 'clutch', evidenceIds: ['KB-WD-WF-007'] },
    { cause: '变速箱卡在空挡或换挡困难', stepKey: 'gear-shift', evidenceIds: ['KB-JD-5E-D0-070'] },
  ] },
};

/**
 * The server supplies an opaque SHA-256-derived session seed and revision.
 * A retried turn gets the same ID, while a new committed episode gets a new ID.
 * This module is browser-bundleable and never handles the raw session identifier.
 */
export function createDiagnosticPlan(input: {
  topic: PlannerTopic;
  scope: PlannerScope;
  sessionSeed: string;
  revision: number;
}): PlannerState {
  if (!Object.hasOwn(templates, input.topic) || typeof input.sessionSeed !== 'string' || !/^[a-f0-9]{32}$/.test(input.sessionSeed) ||
    !Number.isSafeInteger(input.revision) || input.revision < 0) throw new TypeError('Invalid Planner episode identity');
  const digest = `${input.sessionSeed}-${input.revision}-${input.topic}`;
  return createPlan({ planId: `plan-${digest}`, episodeId: `episode-${digest}`, scope: input.scope, steps: templates[input.topic], evidence: [...topicEvidence[input.topic]] });
}
