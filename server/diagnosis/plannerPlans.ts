import { createPlan, type PlannerScope, type PlannerState, type StepDefinition } from '../../agent/planner';

/** Narrow, manually reviewed symptom families. These are not fault diagnoses. */
export type PlannerTopic = 'overheat' | 'starting';

/** Apply to the user's original fault question, not an arbitrary later reply. */
export function identifyPlannerTopic(text: string): PlannerTopic | undefined {
  if (typeof text !== 'string' || text.length > 8000) return undefined;
  const overheat = /(?:水温|冷却|散热|冷却液|发动机温度).{0,24}(?:过高|太高|升高|偏高|很高|高温|过热|开锅|报警)|(?:过高|太高|偏高|高温|过热|开锅).{0,16}(?:水温|冷却|散热|发动机)/i.test(text);
  const starting = /(?:无法|不能|不易|难以|不能够|没法).{0,8}(?:启动|起动|着车)|(?:启动|起动).{0,10}(?:不了|不着|困难|失败|异常|不成功)|打不着|不着车|(?:电瓶|蓄电池|电池).{0,12}(?:亏电|没电|不充电|无法充电|故障|异常|损坏)/i.test(text);
  // Ambiguous multi-system questions cannot safely select a single template.
  return overheat === starting ? undefined : overheat ? 'overheat' : 'starting';
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
};

/** Only these reviewed aliases bind a user's report to a plan step. */
export function plannerStepAliases(stepKey: string): readonly string[] {
  switch (stepKey) {
    case 'cooling-leak': return ['冷却液泄漏', '冷却液渗漏', '冷却系统泄漏', '冷却液漏液'];
    case 'cooling-radiator': return ['散热器表面遮挡', '散热器表面', '散热器遮挡', '散热器'];
    case 'battery': return ['蓄电池', '电瓶', '电池'];
    case 'starter': return ['起动机', '启动机', '起动马达', '启动马达'];
    default: return [];
  }
}

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
  return createPlan({ planId: `plan-${digest}`, episodeId: `episode-${digest}`, scope: input.scope, steps: templates[input.topic] });
}
